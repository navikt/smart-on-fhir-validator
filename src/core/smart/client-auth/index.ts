/**
 * Client authentication to the token endpoint, one strategy per SMART client type.
 * https://build.fhir.org/ig/HL7/smart-app-launch/client-authentication.html
 */

import type { ClientAuthMode, TokenEndpointAuthMethod } from '#core/smart/types'

import { createAsymmetricClientAuthentication } from './asymmetric'
import { createPublicClientAuthentication } from './public'
import { createSymmetricClientAuthentication } from './symmetric'

export type ClientAuthentication = {
    readonly method: TokenEndpointAuthMethod | 'none'
    formFields: () => Promise<Record<string, string>>
    headers: () => Promise<Record<string, string>>
}

export function selectClientAuthentication(
    clientId: string,
    mode: ClientAuthMode,
    tokenEndpoint: string,
): ClientAuthentication {
    switch (mode.type) {
        case 'public':
            return createPublicClientAuthentication(clientId)
        case 'confidential-symmetric':
            return createSymmetricClientAuthentication(clientId, mode.clientSecret, mode.method)
        case 'confidential-asymmetric':
            return createAsymmetricClientAuthentication(clientId, tokenEndpoint, {
                privateKeyJwk: mode.privateKeyJwk,
                keyId: mode.keyId,
                algorithm: mode.algorithm,
            })
    }
}

function authMethodFor(mode: ClientAuthMode): TokenEndpointAuthMethod | 'none' {
    switch (mode.type) {
        case 'public':
            return 'none'
        case 'confidential-symmetric':
            return mode.method
        case 'confidential-asymmetric':
            return 'private_key_jwt'
    }
}

export type AuthNegotiationResult = {
    method: TokenEndpointAuthMethod | 'none'
    warnings: string[]
}

/**
 * Compares the configured auth method against what the EHR advertises, so a mismatch becomes a
 * finding rather than an opaque failure at the token endpoint.
 */
export function negotiateAuthMethod(
    configured: ClientAuthMode,
    supported: string[] | undefined,
): AuthNegotiationResult {
    const method = authMethodFor(configured)
    const warnings: string[] = []

    if (method !== 'none' && supported !== undefined && !supported.includes(method)) {
        warnings.push(
            `This app is configured to authenticate with '${method}', but the EHR's ` +
                `token_endpoint_auth_methods_supported (${supported.join(', ') || 'empty'}) does not list it.`,
        )
    }

    return { method, warnings }
}
