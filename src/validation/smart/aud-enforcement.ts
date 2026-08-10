/**
 * Pure classification logic for the `aud` enforcement probe.
 *
 * SMART App Launch requires the authorization server to validate that the `aud` parameter on an
 * authorization request equals the FHIR server's base URL: "this parameter prevents leaking a
 * genuine bearer token to a counterfeit resource server" (confused-deputy defence — a malicious
 * FHIR server could otherwise replay a captured launch request against a real authorization
 * server to mint a token for a different, genuine resource server). This app's own launch
 * (`#core/smart/launch.ts`) always sends the correct `aud`, so nothing about the real launch can
 * ever observe whether a server actually enforces this. This module only classifies the
 * response to a *separate, deliberately wrong* `aud` request; the HTTP call itself is made by
 * `#core/run/phases/aud-enforcement`, which is the only place that IO happens.
 *
 * @see https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html#step-4-authorization-code
 */

import type { RefTypes } from '#validation/common-refs'
import { validation, type Validation } from '#validation/validation'

const refs: RefTypes = [
    {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Obtain authorization code',
        href: 'https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html#step-4-authorization-code',
    },
]

export type AudEnforcementProbeResponse = {
    /** `0` denotes a transport failure (see `SmartHttpClient`), never a real HTTP status. */
    status: number
    /** The raw `Location` response header, present only for a 3xx response. */
    location: string | null
}

export type AudEnforcementContext = {
    /** The authorization endpoint the probe request was sent to, to resolve a relative `Location`. */
    requestUrl: string
    /** This app's own redirect_uri, so a redirect elsewhere can't be mistaken for this app's callback. */
    redirectUri: string
}

/** A verdict this module can turn directly into a report finding. */
export type ConclusiveAudEnforcementVerdict = { kind: 'rejected' } | { kind: 'not-rejected' }

export type AudEnforcementVerdict =
    | ConclusiveAudEnforcementVerdict
    | {
          kind: 'inconclusive'
          /** Why the response could not be interpreted — surfaced verbatim as a skipped-section reason. */
          reason: string
      }

function inconclusive(reason: string): AudEnforcementVerdict {
    return { kind: 'inconclusive', reason }
}

/** True when `location` points at the same origin and path as this app's registered `redirect_uri`. */
function isOwnCallback(location: URL, redirectUri: string): boolean {
    let expected: URL
    try {
        expected = new URL(redirectUri)
    } catch {
        return false
    }

    return location.origin === expected.origin && location.pathname === expected.pathname
}

function evaluateRedirect(status: number, location: string | null, context: AudEnforcementContext) {
    if (!location) {
        return inconclusive(
            `The authorization endpoint responded with HTTP ${status} but no \`Location\` header.`,
        )
    }

    let target: URL
    try {
        target = new URL(location, context.requestUrl)
    } catch {
        return inconclusive(`The redirect \`Location\` ("${location}") could not be parsed as a URL.`)
    }

    if (!isOwnCallback(target, context.redirectUri)) {
        return inconclusive(
            "The authorization endpoint redirected somewhere other than this app's registered " +
                `redirect_uri (got "${target.origin}${target.pathname}"), so the response cannot be ` +
                'attributed to `aud` validation.',
        )
    }

    if (target.searchParams.has('error')) return { kind: 'rejected' as const }
    if (target.searchParams.has('code')) return { kind: 'not-rejected' as const }

    return inconclusive(
        'The authorization endpoint redirected back to this app without either an `error` or a `code` ' +
            'parameter, so the outcome could not be interpreted.',
    )
}

/**
 * Classifies the response to a deliberately-wrong-`aud` authorization request. Only three
 * outcomes are possible, and they are never conflated: a redirect (or direct 4xx) that rejects
 * the request is `rejected` (the conformant, secure behaviour); a redirect carrying a `code`
 * despite the bad `aud` is `not-rejected` (a security finding); anything the probe cannot safely
 * interpret — a network failure, an interactive login page, an ambiguous redirect — is
 * `inconclusive` and must never be read as either a pass or a fail.
 */
export function evaluateAudEnforcementResponse(
    response: AudEnforcementProbeResponse,
    context: AudEnforcementContext,
): AudEnforcementVerdict {
    const { status, location } = response

    if (status === 0) {
        return inconclusive(
            'The request to the authorization endpoint failed before a response was received.',
        )
    }

    if (status >= 300 && status < 400) return evaluateRedirect(status, location, context)

    // A direct (non-redirect) 4xx is also a valid rejection: RFC 6749 §4.1.2.1 allows an
    // authorization server to report certain errors without redirecting at all.
    if (status >= 400 && status < 500) return { kind: 'rejected' }

    if (status >= 200 && status < 300) {
        return inconclusive(
            `The authorization endpoint responded with HTTP ${status} instead of redirecting or returning ` +
                'an OAuth error, which usually means it rendered an interactive login/consent page. This ' +
                'probe cannot complete an interactive login, so it cannot tell whether the request would ' +
                'ultimately have been accepted or rejected.',
        )
    }

    return inconclusive(`The authorization endpoint responded with an unexpected HTTP status ${status}.`)
}

/** Turns a conclusive verdict into the single finding it produces. `inconclusive` verdicts are
 * never passed here — callers turn those into a `skippedSection` instead (see
 * `#core/run/phases/aud-enforcement`), so a probe that could not run never reads as a pass. */
export function buildAudEnforcementFinding(verdict: ConclusiveAudEnforcementVerdict): Validation {
    switch (verdict.kind) {
        case 'rejected':
            return validation(
                'The authorization server rejected an authorization request whose `aud` parameter ' +
                    "deliberately did not match the FHIR server's base URL, as SMART App Launch requires.",
                'OK',
                refs,
            )

        case 'not-rejected':
            return validation(
                'The authorization server did NOT reject an authorization request whose `aud` parameter ' +
                    "deliberately did not match the FHIR server's base URL. It issued an authorization " +
                    'code anyway. SMART App Launch requires servers to validate `aud` precisely to prevent ' +
                    'a confused-deputy attack: a malicious FHIR server could replay a captured launch ' +
                    'request to obtain an access token minted for a different, genuine resource server.',
                'ERROR',
                refs,
            )
    }
}
