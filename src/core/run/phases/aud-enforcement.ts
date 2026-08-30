/**
 * Diagnostic probe: sends an authorization request with a deliberately wrong `aud` to check
 * whether the server enforces the requirement (classification lives in
 * `#validation/smart/aud-enforcement`).
 *
 * The real launch is untouched: `#core/smart/launch.ts` always sends the correct `aud`. The
 * probe must never complete an authorization: `redirect: 'manual'` stops `fetch` from following
 * a redirect that could carry a genuine authorization code, so it can provoke a code but never
 * collect or exchange one.
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
 * Recovers this app's registered `redirect_uri` from the recorded `token` exchange: it is not on
 * `ActiveSession`, and the token form body is the one place it survives redaction (it is not a
 * credential). Reusing the registered value keeps the probe bound to the same client, so a
 * server that would 400 on an unrecognised `redirect_uri` cannot mask the `aud` result.
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

/** Well-formed enough to pass a shape-only check, but never equal to the real base URL. */
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
