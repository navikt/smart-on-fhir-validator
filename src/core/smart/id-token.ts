import { createRemoteJWKSet, customFetch, decodeJwt, type JWTPayload, jwtVerify } from 'jose'

import type { SmartHttpClient } from '#core/http/smart-http-client'

/**
 * A validator's whole purpose is to surface non-conformance, so a failed signature, issuer,
 * audience or expiry check is a finding to report — never an exception to throw. `claims` is
 * populated on both outcomes (best-effort decoded, unverified, when verification failed) so a
 * caller can still show *something* about the token that was received.
 */
export type IdTokenVerificationResult =
    | { status: 'verified'; claims: JWTPayload; problems: [] }
    | { status: 'failed'; claims: JWTPayload | null; problems: string[] }

export type VerifyIdTokenOptions = {
    jwksUri: string
    issuer: string
    /** The SMART client's own `client_id` — the id token's required audience. */
    clientId: string
    /** Routes the JWKS fetch through the shared recorder so it appears in the evidence trail. */
    httpClient: SmartHttpClient
}

export async function verifyIdToken(
    idToken: string,
    options: VerifyIdTokenOptions,
): Promise<IdTokenVerificationResult> {
    let jwksUrl: URL
    try {
        jwksUrl = new URL(options.jwksUri)
    } catch {
        return {
            status: 'failed',
            claims: decodeIdTokenClaims(idToken),
            problems: [`jwks_uri is not a valid URL: ${options.jwksUri}`],
        }
    }

    const jwks = createRemoteJWKSet(jwksUrl, { [customFetch]: recordedFetch(options.httpClient) })

    try {
        const { payload } = await jwtVerify(idToken, jwks, {
            issuer: options.issuer,
            audience: options.clientId,
        })
        return { status: 'verified', claims: payload, problems: [] }
    } catch (cause) {
        return {
            status: 'failed',
            claims: decodeIdTokenClaims(idToken),
            problems: [describeVerificationError(cause)],
        }
    }
}

/** Unverified inspection only — never use this result to authorize anything. */
export function decodeIdTokenClaims(idToken: string): JWTPayload | null {
    try {
        return decodeJwt(idToken)
    } catch {
        return null
    }
}

function recordedFetch(httpClient: SmartHttpClient): (url: string) => Promise<Response> {
    return async (url) => {
        const recorded = await httpClient.get('jwks', url)
        const body = recorded.body === null ? null : JSON.stringify(recorded.body)
        return new Response(body, { status: recorded.status, headers: recorded.headers })
    }
}

function describeVerificationError(cause: unknown): string {
    if (cause instanceof Error) {
        const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined
        return code ? `${code}: ${cause.message}` : cause.message
    }
    return String(cause)
}
