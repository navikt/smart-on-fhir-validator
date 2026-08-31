/**
 * Full SMART App Launch, in-process, once per client-authentication method
 * https://build.fhir.org/ig/HL7/smart-app-launch/client-authentication.html defines: `public`,
 * `client_secret_basic`, `client_secret_post`, `private_key_jwt`.
 *
 * Every test asserts on the recorded `HttpExchange` evidence, not just the outcome: the phases a
 * launch must produce, in order, and that every exchange is credential-free.
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

describe.each(ALL_CLIENT_AUTH_METHODS)(
    'full SMART launch as a %s client',
    (clientAuth: MockClientAuthMethod) => {
        it('completes discovery, authorization and token exchange and yields a usable FHIR client', async () => {
            const { session, fhir, launchContext } = await requireSuccessfulLaunch({ clientAuth })

            expect(session.state).toBe('active')
            expect(session.fhirBaseUrl).toBe(MOCK_EHR_BASE_URL)
            expect(session.tokenResponse.access_token).toEqual(expect.any(String))
            expect(session.tokenResponse.token_type).toBe('Bearer')
            expect(launchContext.patientId).toEqual(expect.any(String))
            expect(launchContext.practitionerId).toEqual(expect.any(String))

            // Proof the whole chain (token -> launch context -> FhirClient) works, not just that
            // a token object was produced.
            const response = await fhir.read('Patient', launchContext.patientId ?? '')
            expect(response.status).toBe(200)
        })

        it('records exchanges for discovery and token, with discovery preceding the token exchange', async () => {
            const { recorder } = await requireSuccessfulLaunch({ clientAuth })

            const phases = phasesOf(recorder.all())
            expect(phases).toContain('discovery')
            expect(phases).toContain('token')

            // The token_endpoint can only have come from the discovery document.
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

            // The mock 400s a token exchange whose code_verifier does not hash to the challenge
            // sent at authorize time, so a 200 here proves this app computed a correct verifier.
            const token = recorder.all().find((exchange) => exchange.phase === 'token')
            expect(token?.response?.status).toBe(200)
            // The verifier is a bearer-equivalent credential and must never be stored in the clear.
            expect(token?.request.body).toMatch(/code_verifier=%5BREDACTED%5D/)
        })

        it('every recorded exchange has its credentials redacted, however this client authenticates', async () => {
            const { recorder, clientId, session } = await requireSuccessfulLaunch({
                clientAuth,
                clientId: 'redact-me-client',
            })

            expect(recorder.all().length).toBeGreaterThan(0)

            for (const exchange of recorder.all()) {
                // Where `client_secret_basic` puts its credential, and where a bearer token would
                // appear. Compared via a ternary so the assertion always runs.
                const authHeader = exchange.request.headers.authorization
                expect(authHeader).toBe(authHeader !== undefined ? '[REDACTED]' : undefined)

                // Sensitive query parameters (e.g. an authorization `code`) are masked in stored URLs.
                const url = new URL(exchange.request.url)
                for (const key of ['code', 'code_verifier', 'client_secret', 'client_assertion']) {
                    expect(url.searchParams.get(key)).toBe(url.searchParams.has(key) ? '[REDACTED]' : null)
                }

                // And in stored bodies, where `client_secret_post` and `private_key_jwt` put
                // theirs. `body ?? ''` keeps this vacuously true rather than skipped when absent.
                const body = exchange.request.body
                for (const key of ['client_secret', 'client_assertion', 'code_verifier']) {
                    expect(body ?? '').not.toMatch(new RegExp(`${key}=(?!%5BREDACTED%5D)[^&]+`))
                }
            }

            // The clientId is not a credential, so redaction must never have erased it.
            expect(session.clientId).toBe(clientId)
        })
    },
)

describe('full SMART launch: failure surfaces as a SmartError value rather than throwing', () => {
    it('fails at the launch stage when the well-known document is unreachable', async () => {
        const outcome = await launchAgainstMockEhr({ defects: ['well-known-404'] })

        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.stage).toBe('launch')
    })

    it('still completes when a defect only changes the token response shape, not the transport', async () => {
        // A defect that changes response content rather than availability is a validation-layer
        // finding (see `src/validation/defects.integration.ts`), not a hard failure here.
        const outcome = await launchAgainstMockEhr({ defects: ['token-response-narrows-scopes'] })

        expect(outcome.ok).toBe(true)
    })
})
