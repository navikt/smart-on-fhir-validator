/**
 * Client authentication to the token endpoint. https://build.fhir.org/ig/HL7/smart-app-launch/client-authentication.html
 *
 * `ClientAuthMode` (in `#core/smart/types`) is the persisted *configuration* for a given issuer;
 * this module turns it into the concrete form fields/headers a token request needs. Kept as a
 * strategy per auth type (public / symmetric / asymmetric) so each can be developed and tested
 * in isolation, and so a new method never risks touching the others.
 */

import type { ClientAuthMode, TokenEndpointAuthMethod } from '#core/smart/types'

import { createAsymmetricClientAuthentication } from './asymmetric'
import { createPublicClientAuthentication } from './public'
import { createSymmetricClientAuthentication } from './symmetric'

export type ClientAuthentication = {
    readonly method: TokenEndpointAuthMethod | 'none'
    /** Extra form fields to merge into the token request body. */
    formFields: () => Promise<Record<string, string>>
    /** Extra headers to merge into the token request. */
    headers: () => Promise<Record<string, string>>
}

/**
 * `clientId` is passed separately from `mode` because `ClientAuthMode` (fixed by `#core/smart/types`)
 * does not carry it — it is a property of the issuer registration, not of the auth method.
 */
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
 * Compares the auth method this app is configured to use against what the EHR's own discovery
 * document advertises, so a mismatch is surfaced as a finding rather than only failing opaquely
 * at the token endpoint.
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
