/**
 * RFC 7591 Dynamic Client Registration, the fallback when an EHR advertises a
 * `registration_endpoint` and no static credentials are configured for it.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7591
 */

import { exportJWK } from 'jose'
import * as z from 'zod'

import type { SmartHttpClient } from '#core/http/smart-http-client'

import type { ClientAuthMode, IssuerConfig, SmartError, TokenEndpointAuthMethod } from './types'

import { getSigningKey } from './jwks'
import { isSmartError } from './types'

export type RegistrationParams = {
    /** The SMART issuer this registration is for, not the `registrationEndpoint` itself. */
    issuer: string
    clientName: string
    redirectUris: string[]
    scope: string
    tokenEndpointAuthMethod: TokenEndpointAuthMethod | 'none'
    /** Required when `tokenEndpointAuthMethod` is `private_key_jwt`: this app's own JWKS URL. */
    jwksUri?: string
}

/**
 * Parsed as leniently as the discovery document: only `client_id` is required by RFC 7591
 * §3.2.1, and a server may omit or override anything else, including the granted
 * `token_endpoint_auth_method`.
 */
const RegistrationResponseSchema = z.looseObject({
    client_id: z.string(),
    client_secret: z.string().optional().catch(undefined),
    client_secret_expires_at: z.number().optional().catch(undefined),
    registration_access_token: z.string().optional().catch(undefined),
    registration_client_uri: z.string().optional().catch(undefined),
    token_endpoint_auth_method: z.string().optional().catch(undefined),
})

/** RFC 7591 §3.2.2 error response shape. */
const RegistrationErrorSchema = z.looseObject({
    error: z.string().optional().catch(undefined),
    error_description: z.string().optional().catch(undefined),
})

export async function registerClient(
    client: SmartHttpClient,
    registrationEndpoint: string,
    params: RegistrationParams,
): Promise<IssuerConfig | SmartError> {
    const metadata: Record<string, unknown> = {
        client_name: params.clientName,
        redirect_uris: params.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: params.scope,
        token_endpoint_auth_method: params.tokenEndpointAuthMethod,
    }
    if (params.tokenEndpointAuthMethod === 'private_key_jwt' && params.jwksUri) {
        metadata.jwks_uri = params.jwksUri
    }

    const response = await client.postJson('registration', registrationEndpoint, metadata)

    if (!response.ok) {
        return registrationFailure(response.body, response.status, response.exchange.id)
    }

    const parsed = RegistrationResponseSchema.safeParse(response.body)
    if (!parsed.success) {
        return {
            error: 'The registration endpoint returned a 2xx response without a usable client_id',
            detail: parsed.error.message,
            exchangeId: response.exchange.id,
        }
    }

    const auth = await buildClientAuthMode(params.tokenEndpointAuthMethod, parsed.data, response.exchange.id)
    if (isSmartError(auth)) return auth

    return {
        issuer: params.issuer,
        clientId: parsed.data.client_id,
        auth,
        dynamicallyRegistered: true,
    }
}

function registrationFailure(body: unknown, status: number, exchangeId: string): SmartError {
    const parsedError = RegistrationErrorSchema.safeParse(body)
    const rfcError = parsedError.success ? parsedError.data.error : undefined
    const rfcDescription = parsedError.success ? parsedError.data.error_description : undefined

    return {
        error: rfcError
            ? `The registration endpoint rejected the request: ${rfcError}`
            : `The registration endpoint responded with HTTP ${status}`,
        detail: rfcDescription,
        exchangeId,
    }
}

/**
 * Maps the granted `token_endpoint_auth_method` back to a `ClientAuthMode`. RFC 7591 does not
 * require the server to echo it, so what was requested is assumed granted when absent.
 */
async function buildClientAuthMode(
    requested: TokenEndpointAuthMethod | 'none',
    data: z.infer<typeof RegistrationResponseSchema>,
    exchangeId: string,
): Promise<ClientAuthMode | SmartError> {
    const granted = data.token_endpoint_auth_method ?? requested

    switch (granted) {
        case 'none':
            return { type: 'public' }

        case 'client_secret_basic':
        case 'client_secret_post':
            if (!data.client_secret) {
                return {
                    error: `The registration endpoint granted '${granted}' but did not return a client_secret`,
                    exchangeId,
                }
            }
            return { type: 'confidential-symmetric', method: granted, clientSecret: data.client_secret }

        case 'private_key_jwt': {
            const signingKey = await getSigningKey()
            return {
                type: 'confidential-asymmetric',
                privateKeyJwk: JSON.stringify(await exportJWK(signingKey.key)),
                keyId: signingKey.kid,
                algorithm: signingKey.alg,
            }
        }

        default:
            return {
                error: `The registration endpoint granted an unsupported token_endpoint_auth_method: '${granted}'`,
                exchangeId,
            }
    }
}
