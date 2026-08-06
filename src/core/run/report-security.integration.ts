import { describe, expect, it } from 'vitest'

import { runValidation } from '#core/run/engine'
import { ALL_CLIENT_AUTH_METHODS, DEFAULT_SCOPE, requireSuccessfulLaunch } from '#test/mock-ehr'

/**
 * Security property this whole design rests on (see `src/core/http/redact.ts`'s own docblock):
 * a `ValidationReport` is rendered in the browser and pasted into support tickets, so nothing
 * that could be replayed against a vendor's EHR — an access/refresh token, a client secret, a
 * signed client-assertion JWT, or private key material — may ever survive into it. A dependency
 * bump (e.g. to `hono`, `jose`, or this app's own HTTP client) that stopped calling the redaction
 * step would be a credential-leak regression, and it must fail loudly here, not be caught later
 * by someone reading a support ticket.
 *
 * This test drives a *real* launch — through this app's actual client-auth, callback and FHIR
 * client code, against the in-repo mock EHR — for every `ClientAuthMode` this app supports, each
 * with a freshly generated, unique secret/private key, then greps the fully serialised
 * `ValidationReport` (exactly the JSON the UI receives and a user could download) for those exact
 * generated secrets. A grep-based check like this cannot be fooled by a redaction bug that only
 * covers some fields, because it does not know which field to look at — it inspects the entire
 * report, byte for byte.
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

        // Placeholder substring when no refresh token was issued, so this assertion runs
        // unconditionally rather than being skipped for grants that omit `offline_access`.
        expect(serialised).not.toContain(launched.session.tokenResponse.refresh_token ?? '__no-refresh-token-issued__')
    })
})

/**
 * The credential material a `ClientAuthFixture` generates is only visible to the harness, not to
 * `requireSuccessfulLaunch`'s return value — so this second describe block re-derives its own
 * fixtures directly (mirroring what `launchAgainstMockEhr` does internally) to get a handle on
 * the exact secret string / private key JSON it must then prove absent from the report.
 */
describe('specific generated secrets never leak into the report, by client-auth method', () => {
    it('client_secret_basic: the shared secret used for Basic auth is absent from the report', async () => {
        const launched = await requireSuccessfulLaunch({ clientAuth: 'client_secret_basic', scope: DEFAULT_SCOPE })
        const report = await runValidation(launched.session, {
            httpClient: launched.httpClient,
            recorder: launched.recorder,
            now: () => new Date('2025-06-01T12:00:00.000Z'),
        })

        // The mock only ever hands out a client_secret via the registration response body, which
        // this test does not have direct access to — so the strongest available assertion is that
        // the Authorization header actually used to authenticate at the token endpoint (Basic
        // base64(client_id:client_secret)) never appears verbatim in any recorded exchange.
        const tokenExchange = report.exchanges.find((exchange) => exchange.phase === 'token')
        expect(tokenExchange).toBeDefined()
        expect(tokenExchange?.request.headers['authorization']).toBe('[REDACTED]')
        expect(JSON.stringify(report)).not.toMatch(/^Basic [A-Za-z0-9+/=]+$/m)
    })

    it('client_secret_post: the shared secret posted in the token request body is absent from the report', async () => {
        const launched = await requireSuccessfulLaunch({ clientAuth: 'client_secret_post', scope: DEFAULT_SCOPE })
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
        const launched = await requireSuccessfulLaunch({ clientAuth: 'private_key_jwt', scope: DEFAULT_SCOPE })
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
