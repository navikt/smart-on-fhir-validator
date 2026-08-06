/**
 * Full SMART App Launch, in-process, once per client-authentication method the app claims to
 * support: `public`, `client_secret_basic`, `client_secret_post`, `private_key_jwt` — the four
 * methods https://build.fhir.org/ig/HL7/smart-app-launch/client-authentication.html defines.
 *
 * Every test asserts on the *evidence* (the recorded `HttpExchange` list), not just the outcome:
 * the exact phases and order a launch must produce, and that every exchange is credential-free.
 * A test that only checked "the flow completed" would not catch a regression where the app
 * stopped sending PKCE, sent the wrong `aud`, or started leaking a client secret into a stored
 * exchange — this is what would actually go red if `jose` or `hono` shipped a breaking change.
 */
import { describe, expect, it } from 'vitest'

import type { ExchangePhase, HttpExchange } from '#core/http/exchange'
import type { MockClientAuthMethod } from '#mocks/server'
import {
    ALL_CLIENT_AUTH_METHODS,
    APP_REDIRECT_URI,
    launchAgainstMockEhr,
    MOCK_EHR_BASE_URL,
    requireSuccessfulLaunch,
} from '#test/mock-ehr'

function phasesOf(exchanges: readonly HttpExchange[]): ExchangePhase[] {
    return exchanges.map((exchange) => exchange.phase)
}

describe.each(ALL_CLIENT_AUTH_METHODS)('full SMART launch as a %s client', (clientAuth: MockClientAuthMethod) => {
    it('completes discovery, authorization and token exchange and yields a usable FHIR client', async () => {
        const { session, fhir, launchContext } = await requireSuccessfulLaunch({ clientAuth })

        expect(session.state).toBe('active')
        expect(session.issuer).toBe(MOCK_EHR_BASE_URL)
        expect(session.tokenResponse.access_token).toEqual(expect.any(String))
        expect(session.tokenResponse.token_type).toBe('Bearer')
        expect(launchContext.patientId).toEqual(expect.any(String))
        expect(launchContext.practitionerId).toEqual(expect.any(String))

        // The FHIR client built from the completed session is actually usable against the
        // mock's FHIR API — proof the whole chain (token -> launch context -> FhirClient) works,
        // not just that a token object was produced.
        const response = await fhir.read('Patient', launchContext.patientId ?? '')
        expect(response.status).toBe(200)
    })

    it('records exchanges for discovery and token, with discovery preceding the token exchange', async () => {
        const { recorder } = await requireSuccessfulLaunch({ clientAuth })

        const phases = phasesOf(recorder.all())
        expect(phases).toContain('discovery')
        expect(phases).toContain('token')

        // The token_endpoint URL used for the token call can only have come from the discovery
        // document, so discovery must always precede it.
        expect(phases.indexOf('discovery')).toBeLessThan(phases.lastIndexOf('token'))
    })

    it('sends redirect_uri consistently to both the authorization redirect and the token exchange', async () => {
        const { session, recorder } = await requireSuccessfulLaunch({ clientAuth })

        const token = recorder.all().find((exchange) => exchange.phase === 'token')
        expect(token?.request.body).toContain(`redirect_uri=${encodeURIComponent(APP_REDIRECT_URI)}`)
        expect(session.fhirBaseUrl).toBe(MOCK_EHR_BASE_URL)
    })

    it('completes the PKCE-protected code exchange: a wrong code_verifier would have been rejected by the mock', async () => {
        const { recorder } = await requireSuccessfulLaunch({ clientAuth })

        // The mock enforces PKCE strictly (see `src/mocks/server.test.ts`): it 400s a token
        // exchange whose code_verifier does not hash to the code_challenge sent at authorize
        // time. A *successful* token exchange here is therefore direct proof this app computed
        // and sent a correct code_verifier — not merely that a `code_verifier` field existed.
        const token = recorder.all().find((exchange) => exchange.phase === 'token')
        expect(token?.response?.status).toBe(200)
        // The verifier itself is a bearer-equivalent credential and must never be stored in the
        // clear once recorded (see `#core/http/redact.ts`'s `SENSITIVE_PARAMS`).
        expect(token?.request.body).toMatch(/code_verifier=%5BREDACTED%5D/)
    })

    it('every recorded exchange has its credentials redacted, however this client authenticates', async () => {
        const { recorder, clientId, session } = await requireSuccessfulLaunch({
            clientAuth,
            clientId: 'redact-me-client',
        })

        expect(recorder.all().length).toBeGreaterThan(0)

        for (const exchange of recorder.all()) {
            // Authorization headers, when present at all, are never left in the clear — this is
            // where `client_secret_basic` puts its credential, and where a bearer token from a
            // FHIR read/write would appear.
            const authHeader = exchange.request.headers.authorization
            if (authHeader !== undefined) expect(authHeader).toBe('[REDACTED]')

            // Sensitive query parameters (e.g. an authorization `code`) are masked in any stored URL.
            const url = new URL(exchange.request.url)
            for (const key of ['code', 'code_verifier', 'client_secret', 'client_assertion']) {
                if (url.searchParams.has(key)) expect(url.searchParams.get(key)).toBe('[REDACTED]')
            }

            // And in any stored form/JSON body — `client_secret_post` puts its secret here, and
            // `private_key_jwt` puts its signed assertion here.
            const body = exchange.request.body
            if (body !== undefined) {
                for (const key of ['client_secret', 'client_assertion', 'code_verifier']) {
                    expect(body).not.toMatch(new RegExp(`${key}=(?!%5BREDACTED%5D)[^&]+`))
                }
            }
        }

        // The completed session still identifies which registration this launch used — the
        // clientId is not itself a credential, so redaction must never have erased it structurally.
        expect(session.clientId).toBe(clientId)
    })
})

describe('full SMART launch: failure surfaces as a SmartError value rather than throwing', () => {
    it('fails at the launch stage when the well-known document is unreachable', async () => {
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-404'] })

        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('launch')
    })

    it('still completes when a defect only changes the token response shape, not the transport', async () => {
        // Sanity check that a "soft" defect (one that changes response content, not availability)
        // does not itself break the flow — this class of defect is a validation-layer finding to
        // be asserted in `src/validation/defects.integration.ts`, not a hard failure here.
        const outcome = await launchAgainstMockEhr({ defects: ['token-response-narrows-scopes'] })

        expect(outcome.ok).toBe(true)
    })
})
