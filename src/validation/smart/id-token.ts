/**
 * Validation of the SMART `id_token` — an OpenID Connect ID Token carrying the SMART-specific
 * `fhirUser` claim that identifies the logged-in clinician.
 *
 * Signature/issuer/audience/expiry verification is `#core/smart/id-token`'s job — it owns the
 * `jose` `jwtVerify` call and routes the JWKS fetch through the shared `SmartHttpClient` recorder
 * so a broken `jwks_uri` still leaves an `HttpExchange` to look at. This module takes the
 * already-computed `IdTokenVerificationResult` (evidence) and turns it, plus the SMART-specific
 * claims, into findings — a pure function with no IO of its own, consistent with the other
 * validators in this directory (they all take already-fetched data, never fetch it themselves).
 *
 * @see https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html#scopes-for-requesting-identity-data
 * @see https://openid.net/specs/openid-connect-core-1_0.html#IDToken
 */

import type { JWTPayload } from 'jose'

import { decodeIdTokenClaims, type IdTokenVerificationResult } from '#core/smart/id-token'
import type { SpecRef } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

const scopesUrl = 'https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html'
const oidcCoreUrl = 'https://openid.net/specs/openid-connect-core-1_0.html'

const refs = {
    identityScopes: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Scopes for requesting identity data',
        href: `${scopesUrl}#scopes-for-requesting-identity-data`,
    },
    idTokenClaims: {
        authority: 'oidc',
        cite: 'OpenID Connect Core 1.0 §ID Token',
        href: `${oidcCoreUrl}#IDToken`,
    },
    /** SMART's own security considerations, which single out `iss`/`aud` validation. */
    security: { authority: 'fhir', cite: 'FHIR §Security', href: 'https://hl7.org/fhir/security.html' },
} satisfies Record<string, SpecRef>

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

export type ValidateIdTokenOptions = {
    idToken: string | undefined
    /**
     * The result of `verifyIdToken` (`#core/smart/id-token`), or `null` when verification could
     * not even be attempted — e.g. the SMART configuration had no `issuer`/`jwks_uri`. Claim
     * checks below still run against a best-effort decode in that case.
     */
    verification: IdTokenVerificationResult | null
    /** Required when `verification` is `null`, to explain why in the finding. */
    verificationSkippedReason?: string
    /** Whether an identity claim (`fhirUser`/`profile`) was requested via `openid` + one of them. */
    identityClaimRequested: boolean
    /** The nonce this app sent with the authorization request, if any. */
    sentNonce?: string
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
                    [refs.identityScopes],
                ),
            )
            return
        }

        if (identityClaimRequested) {
            validator.error(
                'The id_token has neither a `fhirUser` nor a `profile` claim, even though an identity ' +
                    'scope was requested. Without it, the app cannot identify the logged-in clinician.',
                [refs.identityScopes],
            )
        }
        return
    }

    const reference = parseFhirReference(fhirUser)
    if (!reference || !isFhirUserResourceType(reference.resourceType)) {
        validator.error(
            `The \`fhirUser\` claim (\`${fhirUser}\`) is not a resolvable reference to a Practitioner, ` +
                'Patient, RelatedPerson or Person resource.',
            [refs.identityScopes],
        )
        return
    }

    ok.push(
        validation(`\`fhirUser\` claim resolves to \`${reference.resourceType}/${reference.id}\``, 'OK', [
            refs.identityScopes,
        ]),
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
                    [refs.idTokenClaims],
                ),
            )
        }
        return
    }

    if (claimNonce === undefined) {
        validator.error(
            'This app sent a `nonce` with the authorization request, but the id_token does not echo it ' +
                'back in a `nonce` claim; replay protection cannot be confirmed.',
            [refs.security],
        )
        return
    }

    if (claimNonce !== sentNonce) {
        validator.error(
            `The id_token's \`nonce\` claim (\`${claimNonce}\`) does not match the nonce this app sent ` +
                `(\`${sentNonce}\`); this could indicate a replay attack.`,
            [refs.security],
        )
        return
    }

    ok.push(validation('The id_token `nonce` claim matches the nonce this app sent', 'OK', [refs.security]))
}

/**
 * Turns an already-computed `IdTokenVerificationResult` plus the SMART/OIDC claim requirements
 * into findings. Returns `[]` when there is no id_token to validate — its presence (or required
 * absence) is `token-response.ts`'s concern, not this module's.
 */
export function validateIdToken(options: ValidateIdTokenOptions): Validation[] {
    const { idToken, verification, verificationSkippedReason, identityClaimRequested, sentNonce } = options
    const validator = new Validator()
    const ok: Validation[] = []

    if (!idToken) return []

    let claims: JWTPayload

    if (verification === null) {
        validator.error(
            `The id_token signature could not be verified: ${verificationSkippedReason ?? 'no reason given'}.`,
            [refs.idTokenClaims],
        )
        claims = decodeIdTokenClaims(idToken) ?? {}
    } else if (verification.status === 'verified') {
        claims = verification.claims
        ok.push(
            validation("The id_token signature verifies against the issuer's JWKS", 'OK', [
                refs.idTokenClaims,
            ]),
        )
        ok.push(
            validation(`\`iss\` (\`${String(claims.iss)}\`) matches the SMART configuration issuer`, 'OK', [
                refs.security,
            ]),
        )
        ok.push(
            validation(`\`aud\` (\`${String(claims.aud)}\`) includes this app's client_id`, 'OK', [
                refs.security,
            ]),
        )
        ok.push(
            validation('The id_token is not expired, and `nbf`/`iat` are satisfied', 'OK', [
                refs.idTokenClaims,
            ]),
        )
    } else {
        validator.error(`The id_token failed verification: ${verification.problems.join('; ')}`, [
            refs.idTokenClaims,
        ])
        claims = verification.claims ?? {}
    }

    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
        validator.error('The id_token has no `sub` claim; OpenID Connect Core requires one.', [
            refs.idTokenClaims,
        ])
    } else {
        ok.push(validation('`sub` claim is present', 'OK', [refs.idTokenClaims]))
    }

    if (typeof claims.iat === 'number') {
        const nowSeconds = Math.floor(Date.now() / 1000)
        const CLOCK_SKEW_TOLERANCE_SECONDS = 60
        if (claims.iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) {
            validator.warn(
                `The id_token's \`iat\` claim is in the future (${new Date(claims.iat * 1000).toISOString()}); ` +
                    'this suggests a clock skew between this app and the issuer.',
                [refs.idTokenClaims],
            )
        }
    }

    validateFhirUserClaim(claims, identityClaimRequested, validator, ok)
    validateNonce(claims, sentNonce, validator, ok)

    return [...validator.build(), ...ok]
}
