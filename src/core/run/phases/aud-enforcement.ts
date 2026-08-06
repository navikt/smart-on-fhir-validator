/**
 * Diagnostic probe: deliberately sends an authorization request whose `aud` does not match the
 * FHIR server's base URL, to check whether the server actually enforces the requirement (see
 * `#validation/smart/aud-enforcement` for the "why" and the pure classification logic). This is
 * the only place the probe's own HTTP call happens — everything else about interpreting the
 * result is a pure function over the response.
 *
 * This must never be confused with, or affect, the real launch: `#core/smart/launch.ts` always
 * sends the correct `aud` and is untouched by this file. The probe's request also must never be
 * allowed to complete an authorization — `redirect: 'manual'` stops `fetch` from following a
 * redirect that could carry a genuine authorization code, so the worst this probe can do is
 * *provoke* a code, never *collect* and exchange one.
 */

import { randomUUID } from 'node:crypto'

import type { SmartHttpClient } from '#core/http/smart-http-client'
import { resolveEndpoint } from '#core/smart/discovery'
import { createPkcePair } from '#core/smart/pkce'
import type { ActiveSession, SmartConfiguration } from '#core/smart/types'
import { evaluateAudEnforcementResponse, buildAudEnforcementFinding } from '#validation/smart/aud-enforcement'

import { buildSection, skippedSection, type ReportSection } from '../report'

const SECTION_ID = 'aud-enforcement'
const TITLE = 'Authorization server `aud` enforcement'

/**
 * Recovers this app's own registered `redirect_uri` from the session's already-recorded `token`
 * exchange: `ActiveSession` does not carry it directly (see `#core/smart/types`), and the token
 * endpoint's form body is the one place it is guaranteed to survive redaction (`redirect_uri` is
 * not a credential — see `#core/http/redact.ts`). Reusing the value the real launch registered
 * keeps this probe's request bound to the same client, so a server that would otherwise 400 on
 * an unrecognised `redirect_uri` doesn't mask the one thing this probe actually wants to test.
 */
function findRegisteredRedirectUri(session: ActiveSession): string | null {
    let found: string | null = null
    for (const exchange of session.exchanges) {
        if (exchange.phase !== 'token' || typeof exchange.request.body !== 'string') continue

        const redirectUri = new URLSearchParams(exchange.request.body).get('redirect_uri')
        if (redirectUri) found = redirectUri
    }
    return found
}

/**
 * Deliberately wrong but well-formed, so it still looks like a plausible FHIR base URL to a
 * server that only checks shape — the point is that it is never equal to the real one.
 */
function buildWrongAud(fhirBaseUrl: string): string {
    const url = new URL(fhirBaseUrl)
    url.hostname = `aud-enforcement-probe.${url.hostname}`
    return url.toString()
}

function skipped(reason: string): ReportSection {
    return skippedSection({ id: SECTION_ID, title: TITLE, category: 'smart', reason })
}

export async function runAudEnforcementPhase(
    session: ActiveSession,
    smartConfiguration: SmartConfiguration,
    http: SmartHttpClient,
): Promise<ReportSection> {
    const authorizationEndpoint = resolveEndpoint(
        smartConfiguration.authorization_endpoint,
        session.fhirBaseUrl,
    )
    if (!authorizationEndpoint) {
        return skipped(
            'SMART configuration did not advertise an authorization_endpoint, so this diagnostic probe ' +
                'could not run.',
        )
    }

    const redirectUri = findRegisteredRedirectUri(session)
    if (!redirectUri) {
        return skipped(
            "Could not recover this app's registered redirect_uri from the session's recorded " +
                'exchanges, so this diagnostic probe could not run.',
        )
    }

    const pkce = createPkcePair()
    const requestUrl = new URL(authorizationEndpoint)
    requestUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: session.clientId,
        redirect_uri: redirectUri,
        scope: session.requestedScope,
        state: randomUUID(),
        // The one deliberately-wrong parameter — see the module doc for why.
        aud: buildWrongAud(session.fhirBaseUrl),
        code_challenge: pkce.codeChallenge,
        code_challenge_method: pkce.method,
    }).toString()

    const response = await http.send('authorization', requestUrl.toString(), {
        method: 'GET',
        // Never follow a redirect that could carry a real authorization code: this probe only
        // provokes a rejection, it must never complete one.
        redirect: 'manual',
    })

    const verdict = evaluateAudEnforcementResponse(
        { status: response.status, location: response.headers.get('location') },
        { requestUrl: requestUrl.toString(), redirectUri },
    )

    if (verdict.kind === 'inconclusive') return skipped(verdict.reason)

    return buildSection({
        id: SECTION_ID,
        title: TITLE,
        category: 'smart',
        exchangeId: response.exchange.id,
        validations: [buildAudEnforcementFinding(verdict)],
    })
}
