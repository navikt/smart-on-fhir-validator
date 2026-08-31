import { describe, expect, it, vi } from 'vitest'

import { createExchangeRecorder, type ExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { createInMemorySessionStore } from '#core/storage/session-store'
import type { IssuerConfig, PendingSession, SmartConfiguration, SmartError } from '#core/smart/types'
import { isSmartError } from '#core/smart/types'

import {
    ACTIVE_SESSION_TTL_SECONDS,
    type CallbackDependencies,
    handleCallback,
    type SelectClientAuthentication,
} from './callback'

const FHIR_BASE_URL = 'https://ehr.example.com/fhir'
const TOKEN_ENDPOINT = 'https://ehr.example.com/oauth/token'
const REDIRECT_URI = 'https://validator.nav.no/callback'
const SESSION_ID = 'session-abc'

function smartConfiguration(overrides: Partial<SmartConfiguration> = {}): SmartConfiguration {
    return { issuer: 'https://ehr.example.com', token_endpoint: TOKEN_ENDPOINT, ...overrides }
}

function pendingSession(overrides: Partial<PendingSession> = {}): PendingSession {
    return {
        state: 'pending',
        sessionId: SESSION_ID,
        fhirBaseUrl: FHIR_BASE_URL,
        clientId: 'client-123',
        oauthState: 'state-abc',
        codeVerifier: 'verifier-abc',
        launch: 'launch-xyz',
        requestedScope: 'openid launch',
        createdAt: '2024-01-01T00:00:00.000Z',
        exchanges: [],
        ...overrides,
    }
}

type TokenHandler = (form: URLSearchParams, headers: Headers) => Response

function httpClientWithTokenEndpoint(
    recorder: ExchangeRecorder,
    handler: TokenHandler = () =>
        new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', scope: 'openid launch' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }),
    tokenEndpoint: string = TOKEN_ENDPOINT,
): SmartHttpClient {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url !== tokenEndpoint) return new Response('not found', { status: 404 })

        const body = typeof init?.body === 'string' ? init.body : ''
        const form = new URLSearchParams(body)
        const headers = new Headers(init?.headers as HeadersInit)
        return handler(form, headers)
    }) as typeof fetch

    return new SmartHttpClient({ recorder, fetchImpl })
}

function baseDeps(overrides: Partial<CallbackDependencies> = {}): CallbackDependencies {
    const recorder = createExchangeRecorder()

    return {
        httpClient: httpClientWithTokenEndpoint(recorder),
        recorder,
        sessionStore: createInMemorySessionStore(),
        fetchSmartConfiguration: async () => ({
            config: smartConfiguration(),
            raw: {},
            exchange: {} as never,
        }),
        findIssuerConfig: () => null,
        selectClientAuthentication: () => ({
            formFields: async () => ({}),
            headers: async () => ({}),
        }),
        redirectUri: REDIRECT_URI,
        now: () => new Date('2024-01-01T00:10:00.000Z'),
        ...overrides,
    }
}

async function seedPendingSession(
    deps: CallbackDependencies,
    overrides: Partial<PendingSession> = {},
): Promise<void> {
    const session = pendingSession(overrides)
    await deps.sessionStore.set(session.sessionId, session, 600)
}

describe('handleCallback', () => {
    it('passes through an OAuth error response verbatim', async () => {
        const deps = baseDeps()
        const result = await handleCallback(
            { sessionId: SESSION_ID, error: 'access_denied', error_description: 'user declined' },
            deps,
        )

        expect(result).toEqual({ error: 'access_denied', detail: 'user declined' })
    })

    it('requires both code and state', async () => {
        const deps = baseDeps()
        await seedPendingSession(deps)

        expect(await handleCallback({ sessionId: SESSION_ID, code: 'abc' }, deps)).toMatchObject({
            error: 'invalid_callback',
        })
        expect(await handleCallback({ sessionId: SESSION_ID, state: 'state-abc' }, deps)).toMatchObject({
            error: 'invalid_callback',
        })
    })

    it('fails when there is no pending session for the session id', async () => {
        const deps = baseDeps()
        const result = await handleCallback({ sessionId: 'unknown', code: 'abc', state: 'state-abc' }, deps)
        expect(result).toMatchObject({ error: 'session_not_found' })
    })

    it('fails when the session has already completed its launch', async () => {
        const deps = baseDeps()
        await deps.sessionStore.set(
            SESSION_ID,
            {
                state: 'active',
                sessionId: SESSION_ID,
                fhirBaseUrl: FHIR_BASE_URL,
                clientId: 'client-123',
                requestedScope: 'openid',
                tokenResponse: { access_token: 't', token_type: 'Bearer', scope: 'openid' },
                expiresAt: new Date().toISOString(),
                idTokenClaims: null,
                smartConfiguration: {},
                createdAt: new Date().toISOString(),
                exchanges: [],
            },
            600,
        )

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)
        expect(result).toMatchObject({ error: 'session_not_pending' })
    })

    it('rejects a state that does not match the pending session (CSRF defense)', async () => {
        const deps = baseDeps()
        await seedPendingSession(deps)

        const result = await handleCallback(
            { sessionId: SESSION_ID, code: 'abc', state: 'wrong-state' },
            deps,
        )

        expect(result).toMatchObject({ error: 'state_mismatch' })
    })

    it('rejects a state of different length without throwing', async () => {
        const deps = baseDeps()
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'short' }, deps)

        expect(result).toMatchObject({ error: 'state_mismatch' })
    })

    it('passes through a discovery failure', async () => {
        const discoveryError: SmartError = { error: 'discovery_failed', detail: 'boom' }
        const deps = baseDeps({ fetchSmartConfiguration: async () => discoveryError })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(result).toEqual(discoveryError)
    })

    it('fails when the SMART configuration has no token_endpoint', async () => {
        const deps = baseDeps({
            fetchSmartConfiguration: async () => ({
                config: smartConfiguration({ token_endpoint: undefined }),
                raw: {},
                exchange: {} as never,
            }),
        })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(result).toMatchObject({ error: 'missing_token_endpoint' })
    })

    it('reports a non-2xx token endpoint response as a hard failure, with the exchange id', async () => {
        const recorder = createExchangeRecorder()
        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(
                recorder,
                () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
            ),
        })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(result).toMatchObject({ error: 'token_exchange_failed' })
        expect((result as SmartError).exchangeId).toBeDefined()
    })

    it('reports a 2xx response missing access_token as invalid_token_response, not a crash', async () => {
        const recorder = createExchangeRecorder()
        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(
                recorder,
                () =>
                    new Response(JSON.stringify({ token_type: 'Bearer', scope: 'openid' }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }),
            ),
        })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(result).toMatchObject({ error: 'invalid_token_response' })
    })

    it('uses the static issuer config when one is found for the issuer', async () => {
        const staticConfig: IssuerConfig = {
            fhirBaseUrl: FHIR_BASE_URL,
            clientId: 'static-client',
            auth: { type: 'confidential-symmetric', method: 'client_secret_post', clientSecret: 'sekret' },
            dynamicallyRegistered: false,
        }
        const selectClientAuthentication = vi.fn<SelectClientAuthentication>(() => ({
            formFields: async () => ({}),
            headers: async () => ({}),
        }))
        const deps = baseDeps({ findIssuerConfig: () => staticConfig, selectClientAuthentication })
        await seedPendingSession(deps)

        await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(selectClientAuthentication).toHaveBeenCalledWith(
            'static-client',
            staticConfig.auth,
            TOKEN_ENDPOINT,
        )
    })

    it('allows a public client whose issuer and token_endpoint are on different origins', async () => {
        const selectClientAuthentication = vi.fn<SelectClientAuthentication>(() => ({
            formFields: async () => ({}),
            headers: async () => ({}),
        }))
        const deps = baseDeps({
            findIssuerConfig: () => ({
                fhirBaseUrl: 'https://other-vendor.example.com',
                clientId: 'public-client',
                auth: { type: 'public' },
                dynamicallyRegistered: false,
            }),
            selectClientAuthentication,
        })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(isSmartError(result as SmartError)).toBe(false)
        expect(selectClientAuthentication).toHaveBeenCalledWith(
            'public-client',
            { type: 'public' },
            TOKEN_ENDPOINT,
        )
    })

    it(
        'completes a confidential client token exchange when the authorization server is on a ' +
            'different origin than the FHIR base URL (the Oracle Health/Cerner shape: FHIR on ' +
            'fhir-ehr-code.cerner.com, OAuth on authorization.cerner.com)',
        async () => {
            // Regression guard for the `token_endpoint_origin_mismatch` check removed from this
            // file: SMART App Launch 2.2 places no same-origin constraint between a FHIR base URL
            // and its authorization server (every discovery endpoint need only be an "absolute
            // URL"), and the split-origin shape is real, shipped production behaviour for at least
            // one major vendor. A confidential client's token exchange must succeed here.
            const splitOriginTokenEndpoint = 'https://authorization.cerner.example.com/oauth/token'
            const recorder = createExchangeRecorder()
            const staticConfig: IssuerConfig = {
                fhirBaseUrl: FHIR_BASE_URL,
                clientId: 'static-client',
                auth: {
                    type: 'confidential-symmetric',
                    method: 'client_secret_post',
                    clientSecret: 'sekret',
                },
                dynamicallyRegistered: false,
            }
            const selectClientAuthentication = vi.fn<SelectClientAuthentication>(() => ({
                formFields: async () => ({ client_secret: 'sekret' }),
                headers: async () => ({}),
            }))
            const deps = baseDeps({
                recorder,
                httpClient: httpClientWithTokenEndpoint(recorder, undefined, splitOriginTokenEndpoint),
                fetchSmartConfiguration: async () => ({
                    config: smartConfiguration({ token_endpoint: splitOriginTokenEndpoint }),
                    raw: {},
                    exchange: {} as never,
                }),
                findIssuerConfig: () => staticConfig,
                selectClientAuthentication,
            })
            await seedPendingSession(deps)

            const result = await handleCallback(
                { sessionId: SESSION_ID, code: 'abc', state: 'state-abc' },
                deps,
            )

            expect(isSmartError(result as SmartError)).toBe(false)
            expect(selectClientAuthentication).toHaveBeenCalledWith(
                'static-client',
                staticConfig.auth,
                splitOriginTokenEndpoint,
            )
        },
    )

    it('never follows a redirect on the token exchange, even from an origin that passed the check', async () => {
        // A trusted, origin-matching token_endpoint could still be compromised into 307/308-ing the
        // credential-bearing POST off to another origin. The client must refuse to follow it.
        const recorder = createExchangeRecorder()
        const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
            expect(init?.redirect).toBe('manual')
            return new Response(null, {
                status: 307,
                headers: { Location: 'https://attacker.example.com/token' },
            })
        })
        const staticConfig: IssuerConfig = {
            fhirBaseUrl: FHIR_BASE_URL,
            clientId: 'static-client',
            auth: { type: 'confidential-symmetric', method: 'client_secret_post', clientSecret: 'sekret' },
            dynamicallyRegistered: false,
        }
        const deps = baseDeps({
            httpClient: new SmartHttpClient({ recorder, fetchImpl }),
            recorder,
            findIssuerConfig: () => staticConfig,
        })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({ error: 'token_exchange_failed' })
    })

    it('falls back to a public client auth mode when the issuer has no static config (e.g. it was dynamically registered)', async () => {
        const selectClientAuthentication = vi.fn<SelectClientAuthentication>(() => ({
            formFields: async () => ({}),
            headers: async () => ({}),
        }))
        const deps = baseDeps({ findIssuerConfig: () => null, selectClientAuthentication })
        await seedPendingSession(deps, { clientId: 'dcr-client' })

        await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(selectClientAuthentication).toHaveBeenCalledWith(
            'dcr-client',
            { type: 'public' },
            TOKEN_ENDPOINT,
        )
    })

    it('sends the correct authorization_code grant, redirect_uri and code_verifier, merged with client-auth fields and headers', async () => {
        const recorder = createExchangeRecorder()
        let capturedForm: URLSearchParams | undefined
        let capturedHeaders: Headers | undefined
        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(recorder, (form, headers) => {
                capturedForm = form
                capturedHeaders = headers
                return new Response(
                    JSON.stringify({ access_token: 'tok', token_type: 'Bearer', scope: 'openid launch' }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                )
            }),
            selectClientAuthentication: () => ({
                formFields: async () => ({ client_id: 'client-123' }),
                headers: async () => ({ 'X-Test': 'yes' }),
            }),
        })
        await seedPendingSession(deps)

        await handleCallback({ sessionId: SESSION_ID, code: 'the-code', state: 'state-abc' }, deps)

        expect(capturedForm?.get('grant_type')).toBe('authorization_code')
        expect(capturedForm?.get('code')).toBe('the-code')
        expect(capturedForm?.get('redirect_uri')).toBe(REDIRECT_URI)
        expect(capturedForm?.get('code_verifier')).toBe('verifier-abc')
        expect(capturedForm?.get('client_id')).toBe('client-123')
        expect(capturedHeaders?.get('X-Test')).toBe('yes')
    })

    it('persists an ActiveSession with a lenient token response, preserving unknown vendor fields', async () => {
        const recorder = createExchangeRecorder()
        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(
                recorder,
                () =>
                    new Response(
                        JSON.stringify({
                            access_token: 'tok',
                            token_type: 'Bearer',
                            scope: 'openid launch patient/Patient.read',
                            expires_in: 600,
                            patient: 'Patient/123',
                            vendor_extension: 'unexpected-but-preserved',
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } },
                    ),
            ),
        })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        if (isSmartError(result)) throw new Error('expected an ActiveSession')
        expect(result.state).toBe('active')
        expect(result.tokenResponse.patient).toBe('Patient/123')
        expect((result.tokenResponse as unknown as Record<string, unknown>).vendor_extension).toBe(
            'unexpected-but-preserved',
        )
        expect(result.expiresAt).toBe(new Date('2024-01-01T00:20:00.000Z').toISOString())

        const stored = await deps.sessionStore.get(SESSION_ID)
        expect(stored).toEqual(result)
    })

    it('persists the active session with the configured TTL', async () => {
        const sessionStore = createInMemorySessionStore()
        const setSpy = vi.spyOn(sessionStore, 'set')
        const deps = baseDeps({ sessionStore })
        await seedPendingSession(deps)

        await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        expect(setSpy).toHaveBeenCalledWith(SESSION_ID, expect.anything(), ACTIVE_SESSION_TTL_SECONDS)
    })

    it('decodes id_token claims (unverified) when present, and stores null when absent', async () => {
        const recorder = createExchangeRecorder()
        const idToken = [
            Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
            Buffer.from(JSON.stringify({ iss: 'https://ehr.example.com', sub: 'practitioner-1' })).toString(
                'base64url',
            ),
            '',
        ].join('.')

        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(
                recorder,
                () =>
                    new Response(
                        JSON.stringify({
                            access_token: 'tok',
                            token_type: 'Bearer',
                            scope: 'openid',
                            id_token: idToken,
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } },
                    ),
            ),
        })
        await seedPendingSession(deps)

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        if (isSmartError(result)) throw new Error('expected an ActiveSession')
        expect(result.idTokenClaims).toMatchObject({ sub: 'practitioner-1' })
    })

    it('accumulates and caps the exchanges array from both the launch and callback phases', async () => {
        const recorder = createExchangeRecorder()
        const deps = baseDeps({ recorder, httpClient: httpClientWithTokenEndpoint(recorder) })
        const priorExchange = {
            id: 'prior-1',
            phase: 'discovery' as const,
            request: { method: 'GET', url: FHIR_BASE_URL, headers: {} },
            response: { status: 200, statusText: 'OK', headers: {}, body: {} },
            error: null,
            startedAt: new Date().toISOString(),
            durationMs: 5,
        }
        await seedPendingSession(deps, { exchanges: [priorExchange] })

        const result = await handleCallback({ sessionId: SESSION_ID, code: 'abc', state: 'state-abc' }, deps)

        if (isSmartError(result)) throw new Error('expected an ActiveSession')
        expect(result.exchanges.some((exchange) => exchange.id === 'prior-1')).toBe(true)
        expect(result.exchanges.length).toBeGreaterThan(1)
    })
})
