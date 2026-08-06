/**
 * Validation of the SMART `id_token` — an OpenID Connect ID Token carrying the SMART-specific
 * `fhirUser` claim that identifies the logged-in clinician.
 *
 * Signature verification is delegated to `jose`'s own `jwtVerify`. The key resolver is injected
 * by the caller (typically `createRemoteJWKSet(new URL(jwks_uri))` in production, or a fixed
 * public key / in-memory JWKS in tests), so this module performs no network IO itself — it turns
 * an already-resolvable key plus the token into findings, which is what keeps it testable without
 * a real network call.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html#scopes-for-requesting-identity-data
 * @see https://openid.net/specs/openid-connect-core-1_0.html#IDToken
 */

import { decodeJwt, jwtVerify, type JWTPayload } from 'jose'

import type { RefTypes } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

const scopesUrl = 'https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html'
const oidcCoreUrl = 'https://openid.net/specs/openid-connect-core-1_0.html'

const refs = {
    identityScopes: { hl7: `${scopesUrl}#scopes-for-requesting-identity-data` },
    idTokenClaims: { hl7: `${oidcCoreUrl}#IDToken` },
    /** SMART's own security considerations, which single out `iss`/`aud` validation. */
    security: { hl7: 'https://hl7.org/fhir/security.html' },
} satisfies Record<string, RefTypes>

const FHIR_USER_RESOURCE_TYPES = ['Practitioner', 'Patient', 'RelatedPerson', 'Person'] as const

export type FhirUserResourceType = (typeof FHIR_USER_RESOURCE_TYPES)[number]

export type FhirReference = { resourceType: string; id: string }

/**
 * Matches a relative FHIR reference (`Practitioner/123`) or an absolute URL ending in one
 * (`https://ehr.example.org/fhir/Practitioner/123`). FHIR ids allow letters, digits, `-` and `.`.
 */
const REFERENCE_RE = /(?:^|\/)([A-Za-z][A-Za-z0-9]*)\/([A-Za-z0-9\-.]{1,64})$/

export function parseFhirReference(value: string): FhirReference | null {
    const match = REFERENCE_RE.exec(value)
    if (!match) return null
    const [, resourceType, id] = match
    if (!resourceType || !id) return null
    return { resourceType, id }
}

function isFhirUserResourceType(resourceType: string): resourceType is FhirUserResourceType {
    return (FHIR_USER_RESOURCE_TYPES as readonly string[]).includes(resourceType)
}

/** The key material or key resolver `jwtVerify` accepts — reused as-is so this stays in lockstep with jose. */
export type IdTokenKeyResolver = Parameters<typeof jwtVerify>[1]

export type ValidateIdTokenOptions = {
    idToken: string | undefined
    /** The SMART configuration's `issuer` — the id_token's required `iss`. */
    issuer: string | undefined
    /** This app's own `client_id` — the id_token's required audience. */
    clientId: string
    /** Injectable so tests can verify against an in-memory key instead of a real JWKS endpoint. */
    keyResolver: IdTokenKeyResolver
    /** Whether an identity claim (`fhirUser`/`profile`) was requested via `openid` + one of them. */
    identityClaimRequested: boolean
    /** The nonce this app sent with the authorization request, if any. */
    sentNonce?: string
}

function describeVerificationError(cause: unknown): string {
    if (cause instanceof Error) {
        const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined
        const claim = 'claim' in cause && typeof cause.claim === 'string' ? cause.claim : undefined
        if (claim && claim !== 'unspecified')
            return `${code ?? cause.name}: \`${claim}\` claim — ${cause.message}`
        return code ? `${code}: ${cause.message}` : cause.message
    }
    return String(cause)
}

/** Unverified inspection only — used purely to surface *something* about a token that failed verification. */
function decodeUnverified(idToken: string): JWTPayload | null {
    try {
        return decodeJwt(idToken)
    } catch {
        return null
    }
}

function validateFhirUserClaim(
    claims: JWTPayload,
    identityClaimRequested: boolean,
    validator: Validator,
    ok: Validation[],
) {
    const fhirUser = typeof claims.fhirUser === 'string' ? claims.fhirUser : undefined
    const profile = typeof claims.profile === 'string' ? claims.profile : undefined

    if (!fhirUser) {
        if (profile) {
            ok.push(
                validation(
                    `Only the deprecated \`profile\` claim is present (\`${profile}\`), not \`fhirUser\`. ` +
                        '`profile` is a deprecated alias; servers should send `fhirUser`.',
                    'INFO',
                    refs.identityScopes,
                ),
            )
            return
        }

        if (identityClaimRequested) {
            validator.error(
                'The id_token has neither a `fhirUser` nor a `profile` claim, even though an identity ' +
                    'scope was requested. Without it, the app cannot identify the logged-in clinician.',
                refs.identityScopes,
            )
        }
        return
    }

    const reference = parseFhirReference(fhirUser)
    if (!reference || !isFhirUserResourceType(reference.resourceType)) {
        validator.error(
            `The \`fhirUser\` claim (\`${fhirUser}\`) is not a resolvable reference to a Practitioner, ` +
                'Patient, RelatedPerson or Person resource.',
            refs.identityScopes,
        )
        return
    }

    ok.push(
        validation(
            `\`fhirUser\` claim resolves to \`${reference.resourceType}/${reference.id}\``,
            'OK',
            refs.identityScopes,
        ),
    )
}

function validateNonce(
    claims: JWTPayload,
    sentNonce: string | undefined,
    validator: Validator,
    ok: Validation[],
) {
    const claimNonce = typeof claims.nonce === 'string' ? claims.nonce : undefined

    if (sentNonce === undefined) {
        if (claimNonce !== undefined) {
            ok.push(
                validation(
                    `The server echoed back a \`nonce\` claim (\`${claimNonce}\`) though this app did not send one`,
                    'INFO',
                    refs.idTokenClaims,
                ),
            )
        }
        return
    }

    if (claimNonce === undefined) {
        validator.error(
            'This app sent a `nonce` with the authorization request, but the id_token does not echo it ' +
                'back in a `nonce` claim; replay protection cannot be confirmed.',
            refs.security,
        )
        return
    }

    if (claimNonce !== sentNonce) {
        validator.error(
            `The id_token's \`nonce\` claim (\`${claimNonce}\`) does not match the nonce this app sent ` +
                `(\`${sentNonce}\`); this could indicate a replay attack.`,
            refs.security,
        )
        return
    }

    ok.push(validation('The id_token `nonce` claim matches the nonce this app sent', 'OK', refs.security))
}

/**
 * Verifies the id_token's signature, issuer and audience, then validates its SMART-specific and
 * OIDC-required claims. Returns `[]` when there is no id_token to validate — its presence (or
 * required absence) is `token-response.ts`'s concern, not this module's.
 */
export async function validateIdToken(options: ValidateIdTokenOptions): Promise<Validation[]> {
    const { idToken, issuer, clientId, keyResolver, identityClaimRequested, sentNonce } = options
    const validator = new Validator()
    const ok: Validation[] = []

    if (!idToken) return []

    const parts = idToken.split('.')
    if (parts.length !== 3) {
        validator.error(
            `The id_token is not a well-formed JWS: expected three dot-separated parts, got ${parts.length}.`,
            refs.idTokenClaims,
        )
        return validator.build()
    }

    if (!issuer) {
        validator.error(
            'Cannot verify the id_token signature: the SMART configuration did not advertise an `issuer`.',
            refs.identityScopes,
        )
        return validator.build()
    }

    let claims: JWTPayload

    try {
        const result = await jwtVerify(idToken, keyResolver, { issuer, audience: clientId })
        claims = result.payload
        ok.push(
            validation("The id_token signature verifies against the issuer's JWKS", 'OK', refs.idTokenClaims),
        )
        ok.push(
            validation(`\`iss\` matches the SMART configuration issuer (\`${issuer}\`)`, 'OK', refs.security),
        )
        ok.push(validation(`\`aud\` includes this app's client_id (\`${clientId}\`)`, 'OK', refs.security))
        ok.push(
            validation(
                'The id_token is not expired, and `nbf`/`iat` are satisfied',
                'OK',
                refs.idTokenClaims,
            ),
        )
    } catch (cause) {
        validator.error(
            `The id_token failed verification: ${describeVerificationError(cause)}`,
            refs.idTokenClaims,
        )
        claims = decodeUnverified(idToken) ?? {}
    }

    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
        validator.error(
            'The id_token has no `sub` claim; OpenID Connect Core requires one.',
            refs.idTokenClaims,
        )
    } else {
        ok.push(validation('`sub` claim is present', 'OK', refs.idTokenClaims))
    }

    if (typeof claims.iat === 'number') {
        const nowSeconds = Math.floor(Date.now() / 1000)
        const CLOCK_SKEW_TOLERANCE_SECONDS = 60
        if (claims.iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) {
            validator.warn(
                `The id_token's \`iat\` claim is in the future (${new Date(claims.iat * 1000).toISOString()}); ` +
                    'this suggests a clock skew between this app and the issuer.',
                refs.idTokenClaims,
            )
        }
    }

    validateFhirUserClaim(claims, identityClaimRequested, validator, ok)
    validateNonce(claims, sentNonce, validator, ok)

    return [...validator.build(), ...ok]
}
