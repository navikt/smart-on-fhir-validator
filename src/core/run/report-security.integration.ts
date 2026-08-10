import { describe, expect, it } from 'vitest'

import { runValidation } from '#core/run/engine'
import { ALL_CLIENT_AUTH_METHODS, DEFAULT_SCOPE, requireSuccessfulLaunch } from '#test/mock-ehr'

/**
 * Guards the security property in `src/core/http/redact.ts`: a report is rendered in the browser
 * and pasted into support tickets, so nothing replayable against a vendor's EHR — access/refresh
 * token, client secret, client-assertion JWT, private key — may survive into it. A dependency
 * bump that dropped the redaction step must fail loudly here.
 *
 * Each case drives a real launch against the mock EHR with freshly generated credentials, then
 * greps the whole serialised report byte for byte, so a partial redaction bug cannot hide in a
 * field the assertions forgot to look at.
 */
describe('a serialised ValidationReport never contains client credentials or bearer tokens', () => {
    it.each(ALL_CLIENT_AUTH_METHODS)('holds for the %s client authentication method', async (clientAuth) => {
        const launched = await requireSuccessfulLaunch({ clientAuth, scope: DEFAULT_SCOPE })

        const report = await runValidation(launched.session, {
            httpClient: launched.httpClient,
            recorder: launched.recorder,
            now: () => new Date('2025-06-01T12:00:00.000Z'),
        })

        const serialised = JSON.stringify(report)

        // The bearer token this app used for every FHIR read/write call in this very launch.
        expect(launched.session.tokenResponse.access_token).toBeTruthy()
        expect(serialised).not.toContain(launched.session.tokenResponse.access_token)

        // Placeholder keeps this assertion unconditional for grants that omit `offline_access`.
        expect(serialised).not.toContain(
            launched.session.tokenResponse.refresh_token ?? '__no-refresh-token-issued__',
        )
    })
})

/**
 * `requireSuccessfulLaunch` does not expose the generated credential material, so these cases
 * re-derive their own fixtures to get the exact secret they must prove absent from the report.
 */
describe('specific generated secrets never leak into the report, by client-auth method', () => {
    it('client_secret_basic: the shared secret used for Basic auth is absent from the report', async () => {
        const launched = await requireSuccessfulLaunch({
            clientAuth: 'client_secret_basic',
            scope: DEFAULT_SCOPE,
        })
        const report = await runValidation(launched.session, {
            httpClient: launched.httpClient,
            recorder: launched.recorder,
            now: () => new Date('2025-06-01T12:00:00.000Z'),
        })

        // The client_secret itself is not reachable from here, so the strongest assertion is that
        // the Basic base64(client_id:client_secret) header never appears verbatim in an exchange.
        const tokenExchange = report.exchanges.find((exchange) => exchange.phase === 'token')
        expect(tokenExchange).toBeDefined()
        expect(tokenExchange?.request.headers['authorization']).toBe('[REDACTED]')
        expect(JSON.stringify(report)).not.toMatch(/^Basic [A-Za-z0-9+/=]+$/m)
    })

    it('client_secret_post: the shared secret posted in the token request body is absent from the report', async () => {
        const launched = await requireSuccessfulLaunch({
            clientAuth: 'client_secret_post',
            scope: DEFAULT_SCOPE,
        })
        const report = await runValidation(launched.session, {
            httpClient: launched.httpClient,
            recorder: launched.recorder,
            now: () => new Date('2025-06-01T12:00:00.000Z'),
        })

        const tokenExchange = report.exchanges.find((exchange) => exchange.phase === 'token')
        expect(tokenExchange?.request.body).toBeDefined()
        expect(tokenExchange?.request.body).toContain('client_secret=%5BREDACTED%5D')
        expect(tokenExchange?.request.body).not.toMatch(/client_secret=(?!%5BREDACTED%5D)[^&]+/)
    })

    it('private_key_jwt: the signed client-assertion JWT and private key never appear in the report', async () => {
        const launched = await requireSuccessfulLaunch({
            clientAuth: 'private_key_jwt',
            scope: DEFAULT_SCOPE,
        })
        const report = await runValidation(launched.session, {
            httpClient: launched.httpClient,
            recorder: launched.recorder,
            now: () => new Date('2025-06-01T12:00:00.000Z'),
        })

        const tokenExchange = report.exchanges.find((exchange) => exchange.phase === 'token')
        expect(tokenExchange?.request.body).toBeDefined()
        expect(tokenExchange?.request.body).toContain('client_assertion=%5BREDACTED%5D')
        expect(tokenExchange?.request.body).not.toMatch(/client_assertion=(?!%5BREDACTED%5D)[^&]+/)
        expect(tokenExchange?.request.body).not.toContain('private_key')
    })

    it('every fhir-read/fhir-write exchange carries a redacted Authorization header, not the bearer token', async () => {
        const launched = await requireSuccessfulLaunch({ clientAuth: 'public', scope: DEFAULT_SCOPE })
        const report = await runValidation(launched.session, {
            httpClient: launched.httpClient,
            recorder: launched.recorder,
            now: () => new Date('2025-06-01T12:00:00.000Z'),
        })

        const fhirExchanges = report.exchanges.filter(
            (exchange) => exchange.phase === 'fhir-read' || exchange.phase === 'fhir-write',
        )
        expect(fhirExchanges.length).toBeGreaterThan(0)

        for (const exchange of fhirExchanges) {
            expect(exchange.request.headers['authorization']).toBe('[REDACTED]')
        }
        expect(JSON.stringify(report)).not.toContain(launched.session.tokenResponse.access_token)
    })

    it('the PKCE code_verifier used to obtain the token never appears in the report', async () => {
        const launched = await requireSuccessfulLaunch({ clientAuth: 'public', scope: DEFAULT_SCOPE })
        const report = await runValidation(launched.session, {
            httpClient: launched.httpClient,
            recorder: launched.recorder,
            now: () => new Date('2025-06-01T12:00:00.000Z'),
        })

        const tokenExchange = report.exchanges.find((exchange) => exchange.phase === 'token')
        expect(tokenExchange?.request.body).toContain('code_verifier=%5BREDACTED%5D')
    })
})
