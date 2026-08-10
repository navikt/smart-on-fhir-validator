/**
 * Builds the `LaunchContext` this app's FHIR probes are allowed to use — patient, encounter and
 * practitioner ids, plus the scopes actually granted — from a completed token exchange, and
 * reports what is missing and which probes that will prevent.
 *
 * @see https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html
 */

import type { LaunchContext, TokenResponse } from '#core/smart/types'
import type { SpecRef } from '#validation/common-refs'
import { navRefs } from '#validation/common-refs'
import { parseFhirReference } from '#validation/smart/id-token'
import { validation, type Validation } from '#validation/validation'

const scopesUrl = 'https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html'

const refs = {
    launchContext: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Launch context arrives with your access_token',
        href: `${scopesUrl}#launch-context-arrives-with-your-access_token`,
    },
    identityScopes: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Scopes for requesting identity data',
        href: `${scopesUrl}#scopes-for-requesting-identity-data`,
    },
    navPreFill: navRefs.smartGettingStarted,
} satisfies Record<string, SpecRef>

export type BuildLaunchContextResult = {
    launchContext: LaunchContext
    validations: Validation[]
}

/** Reads the `fhirUser` string claim from decoded id_token claims, tolerating any shape. */
function readFhirUserClaim(idTokenClaims: Record<string, unknown> | null): string | null {
    if (!idTokenClaims) return null
    const value = idTokenClaims.fhirUser
    return typeof value === 'string' && value.length > 0 ? value : null
}

function splitGrantedScopes(scope: string): string[] {
    return scope
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0)
}

/**
 * Builds the `LaunchContext` and the findings explaining what it will and will not support.
 * `idTokenClaims` takes precedence over the token response's own `fhirUser` — the id_token is the
 * cryptographically verifiable source, the token-response field is a same-response convenience
 * copy some servers omit or leave stale.
 */
export function buildLaunchContext(
    tokenResponse: TokenResponse,
    idTokenClaims: Record<string, unknown> | null,
): BuildLaunchContextResult {
    const validations: Validation[] = []

    const patientId = tokenResponse.patient ?? null
    const encounterId = tokenResponse.encounter ?? null
    const fhirUser = readFhirUserClaim(idTokenClaims) ?? tokenResponse.fhirUser ?? null
    const grantedScopes = splitGrantedScopes(tokenResponse.scope)

    let practitionerId: string | null = null
    if (fhirUser) {
        const reference = parseFhirReference(fhirUser)
        if (reference?.resourceType === 'Practitioner') {
            practitionerId = reference.id
        } else if (reference) {
            validations.push(
                validation(
                    `\`fhirUser\` resolves to \`${reference.resourceType}/${reference.id}\`, not a ` +
                        'Practitioner; probes that need the signing clinician (e.g. resolving `Practitioner` ' +
                        'for a sykmelder) cannot run from launch context alone.',
                    'INFO',
                    [refs.identityScopes],
                ),
            )
        } else {
            validations.push(
                validation(
                    `\`fhirUser\` (\`${fhirUser}\`) is not a parseable FHIR reference; the signing ` +
                        'Practitioner cannot be resolved from launch context.',
                    'WARNING',
                    [refs.identityScopes],
                ),
            )
        }
    } else {
        validations.push(
            validation(
                'No `fhirUser` is available in launch context (neither the id_token nor the token ' +
                    'response carried one); the signing Practitioner cannot be resolved, which Nav needs ' +
                    'to identify the clinician.',
                'WARNING',
                [refs.identityScopes, navRefs.smartGettingStarted],
            ),
        )
    }

    if (patientId) {
        validations.push(
            validation(`\`patient\` (\`${patientId}\`) is available; Patient probes can run`, 'OK', [
                refs.launchContext,
            ]),
        )
    } else {
        validations.push(
            validation(
                'No `patient` is available in launch context, so Patient-context probes cannot be run ' +
                    'from launch context alone.',
                'WARNING',
                [refs.launchContext],
            ),
        )
    }

    if (encounterId) {
        validations.push(
            validation(`\`encounter\` (\`${encounterId}\`) is available; Encounter probes can run`, 'OK', [
                refs.launchContext,
            ]),
        )
    } else {
        validations.push(
            validation(
                'No `encounter` is available in launch context, so Encounter and Condition probes cannot ' +
                    'be run from launch context alone. Nav requires an Encounter to be reachable for its ' +
                    'sykmelding pre-fill flow.',
                'WARNING',
                [refs.launchContext, navRefs.smartGettingStarted],
            ),
        )
    }

    if (grantedScopes.length > 0) {
        validations.push(
            validation(
                `${grantedScopes.length} scope(s) were granted and will gate which probes may run`,
                'OK',
                [refs.launchContext],
            ),
        )
    } else {
        validations.push(
            validation(
                'The granted `scope` string is empty; no probe that depends on a specific permission can run.',
                'WARNING',
                [refs.launchContext],
            ),
        )
    }

    const launchContext: LaunchContext = {
        patientId,
        encounterId,
        fhirUser,
        practitionerId,
        grantedScopes,
    }

    return { launchContext, validations }
}
