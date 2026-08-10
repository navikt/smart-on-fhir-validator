import { createRemoteJWKSet, customFetch, decodeJwt, type JWTPayload, jwtVerify } from 'jose'

import type { SmartHttpClient } from '#core/http/smart-http-client'

/**
 * A failed signature, issuer, audience or expiry check is a finding to report, never an
 * exception. `claims` is populated on both outcomes (unverified when verification failed) so the
 * report can still show what the EHR actually issued.
 */
export type IdTokenVerificationResult =
    | { status: 'verified'; claims: JWTPayload; problems: [] }
    | { status: 'failed'; claims: JWTPayload | null; problems: string[] }

export type IdTokenKeyResolver = Parameters<typeof jwtVerify>[1]

export type VerifyIdTokenOptions = {
    issuer: string
    /** The SMART client's own `client_id` — the id token's required audience. */
    clientId: string
    /** The issuer's JWKS endpoint. Ignored when `keyResolver` is given. */
    jwksUri?: string
    /** Routes the JWKS fetch through the shared recorder so it appears in the evidence trail. */
    httpClient?: SmartHttpClient
    /**
     * An already-resolvable key or key resolver, for hermetic tests that sign against an
     * in-memory key pair. Takes precedence over `jwksUri`/`httpClient` and performs no network IO.
     */
    keyResolver?: IdTokenKeyResolver
}

export async function verifyIdToken(
    idToken: string,
    options: VerifyIdTokenOptions,
): Promise<IdTokenVerificationResult> {
    const key = options.keyResolver ?? buildJwksKeyResolver(options)
    if (typeof key === 'string') {
        // `buildJwksKeyResolver` returned an error message rather than a resolver.
        return { status: 'failed', claims: decodeIdTokenClaims(idToken), problems: [key] }
    }

    try {
        const { payload } = await jwtVerify(idToken, key, {
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

/**
 * Returns an error message rather than throwing when `jwksUri`/`httpClient` are missing or
 * malformed, so that becomes a reported failure instead of an exception or a wasted network call.
 */
function buildJwksKeyResolver(options: VerifyIdTokenOptions): IdTokenKeyResolver | string {
    if (!options.jwksUri || !options.httpClient) {
        return 'verifyIdToken requires either a `keyResolver` or both `jwksUri` and `httpClient`'
    }

    let jwksUrl: URL
    try {
        jwksUrl = new URL(options.jwksUri)
    } catch {
        return `jwks_uri is not a valid URL: ${options.jwksUri}`
    }

    return createRemoteJWKSet(jwksUrl, { [customFetch]: recordedFetch(options.httpClient) })
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

/** Surfaces jose's error `code` and, where present, the claim that failed (`iss`, `aud`, `exp`). */
export function describeVerificationError(cause: unknown): string {
    if (cause instanceof Error) {
        const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined
        const claim = 'claim' in cause && typeof cause.claim === 'string' ? cause.claim : undefined
        if (claim && claim !== 'unspecified')
            return `${code ?? cause.name}: \`${claim}\` claim — ${cause.message}`
        return code ? `${code}: ${cause.message}` : cause.message
    }
    return String(cause)
}
