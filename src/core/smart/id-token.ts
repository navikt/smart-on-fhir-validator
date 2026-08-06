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

/** The key material or key resolver `jwtVerify` accepts — reused as-is so this stays in lockstep with jose. */
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
     * An already-resolvable key or key resolver, e.g. for hermetic tests that sign against an
     * in-memory key pair rather than a fetched JWKS. Takes precedence over `jwksUri`/`httpClient`
     * when given, and performs no network IO of its own.
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
 * Builds the JWKS-backed key resolver used when the caller did not inject one directly. Returns
 * a plain string (rather than throwing) when `jwksUri`/`httpClient` are missing or malformed, so
 * `verifyIdToken` can turn that straight into a `failed` result without a network call.
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

/**
 * Extracts jose's own `code` and, where present, the specific `claim` that failed (e.g. `iss`,
 * `aud`, `exp`) so a caller doesn't have to re-derive which claim was at fault from prose alone.
 */
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
