import { describe, expect, it, vi } from 'vitest'

import { createExchangeRecorder, type ExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { createInMemorySessionStore } from '#core/storage/session-store'
import type { ActiveSession } from '#core/smart/types'
import { isSmartError } from '#core/smart/types'

import { type RefreshDependencies, refreshSession } from './refresh'

const TOKEN_ENDPOINT = 'https://ehr.example.com/oauth/token'
const SESSION_ID = 'session-abc'

function activeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
    return {
        state: 'active',
        sessionId: SESSION_ID,
        issuer: 'https://ehr.example.com',
        fhirBaseUrl: 'https://ehr.example.com/fhir',
        clientId: 'client-123',
        requestedScope: 'openid launch offline_access',
        tokenResponse: {
            access_token: 'old-access-token',
            token_type: 'Bearer',
            scope: 'openid launch offline_access',
            refresh_token: 'old-refresh-token',
        },
        expiresAt: '2024-01-01T00:05:00.000Z',
        idTokenClaims: null,
        smartConfiguration: { issuer: 'https://ehr.example.com', token_endpoint: TOKEN_ENDPOINT },
        createdAt: '2024-01-01T00:00:00.000Z',
        exchanges: [],
        ...overrides,
    }
}

type TokenHandler = (form: URLSearchParams) => Response

function httpClientWithTokenEndpoint(
    recorder: ExchangeRecorder,
    handler: TokenHandler = () =>
        new Response(
            JSON.stringify({
                access_token: 'new-access-token',
                token_type: 'Bearer',
                scope: 'openid launch',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
): SmartHttpClient {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url !== TOKEN_ENDPOINT) return new Response('not found', { status: 404 })

        const body = typeof init?.body === 'string' ? init.body : ''
        return handler(new URLSearchParams(body))
    }) as typeof fetch

    return new SmartHttpClient({ recorder, fetchImpl })
}

function baseDeps(overrides: Partial<RefreshDependencies> = {}): RefreshDependencies {
    const recorder = createExchangeRecorder()

    return {
        httpClient: httpClientWithTokenEndpoint(recorder),
        recorder,
        sessionStore: createInMemorySessionStore(),
        clientAuth: { formFields: async () => ({}), headers: async () => ({}) },
        now: () => new Date('2024-01-01T00:10:00.000Z'),
        ...overrides,
    }
}

describe('refreshSession', () => {
    it('fails when there is no session for the given id', async () => {
        const result = await refreshSession(SESSION_ID, baseDeps())
        expect(result).toMatchObject({ error: 'session_not_found' })
    })

    it('fails when the session has not completed its launch', async () => {
        const deps = baseDeps()
        await deps.sessionStore.set(
            SESSION_ID,
            {
                state: 'pending',
                sessionId: SESSION_ID,
                issuer: 'https://ehr.example.com',
                fhirBaseUrl: 'https://ehr.example.com/fhir',
                clientId: 'client-123',
                oauthState: 'state',
                codeVerifier: 'verifier',
                launch: 'launch',
                requestedScope: 'openid',
                createdAt: new Date().toISOString(),
                exchanges: [],
            },
            600,
        )

        const result = await refreshSession(SESSION_ID, deps)

        expect(result).toMatchObject({ error: 'session_not_active' })
    })

    it('refuses to refresh when neither offline_access nor online_access was granted', async () => {
        const deps = baseDeps()
        await deps.sessionStore.set(
            SESSION_ID,
            activeSession({
                tokenResponse: {
                    access_token: 'a',
                    token_type: 'Bearer',
                    scope: 'openid launch patient/Patient.read',
                    refresh_token: 'r',
                },
            }),
            86400,
        )

        const result = await refreshSession(SESSION_ID, deps)

        expect(result).toMatchObject({ error: 'refresh_not_permitted' })
    })

    it('permits a refresh when online_access (not just offline_access) was granted', async () => {
        const deps = baseDeps()
        await deps.sessionStore.set(
            SESSION_ID,
            activeSession({
                tokenResponse: {
                    access_token: 'a',
                    token_type: 'Bearer',
                    scope: 'openid online_access',
                    refresh_token: 'r',
                },
            }),
            86400,
        )

        const result = await refreshSession(SESSION_ID, deps)

        expect(isSmartError(result)).toBe(false)
    })

    it('fails when the session has no refresh_token', async () => {
        const deps = baseDeps()
        await deps.sessionStore.set(
            SESSION_ID,
            activeSession({
                tokenResponse: {
                    access_token: 'a',
                    token_type: 'Bearer',
                    scope: 'openid offline_access',
                },
            }),
            86400,
        )

        const result = await refreshSession(SESSION_ID, deps)

        expect(result).toMatchObject({ error: 'missing_refresh_token' })
    })

    it('fails when the stored SMART configuration has no token_endpoint', async () => {
        const deps = baseDeps()
        await deps.sessionStore.set(
            SESSION_ID,
            activeSession({ smartConfiguration: { issuer: 'https://ehr.example.com' } }),
            86400,
        )

        const result = await refreshSession(SESSION_ID, deps)

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
        await deps.sessionStore.set(SESSION_ID, activeSession(), 86400)

        const result = await refreshSession(SESSION_ID, deps)

        expect(result).toMatchObject({ error: 'refresh_failed' })
        expect((result as { exchangeId?: string }).exchangeId).toBeDefined()
    })

    it('reports a 2xx response missing access_token as invalid_token_response', async () => {
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
        await deps.sessionStore.set(SESSION_ID, activeSession(), 86400)

        const result = await refreshSession(SESSION_ID, deps)

        expect(result).toMatchObject({ error: 'invalid_token_response' })
    })

    it('sends grant_type=refresh_token and the refresh token, merged with client-auth form fields', async () => {
        const recorder = createExchangeRecorder()
        let capturedForm: URLSearchParams | undefined
        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(recorder, (form) => {
                capturedForm = form
                return new Response(
                    JSON.stringify({ access_token: 'new-token', token_type: 'Bearer', scope: 'openid' }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                )
            }),
            clientAuth: { formFields: async () => ({ client_id: 'client-123' }), headers: async () => ({}) },
        })
        await deps.sessionStore.set(SESSION_ID, activeSession(), 86400)

        await refreshSession(SESSION_ID, deps)

        expect(capturedForm?.get('grant_type')).toBe('refresh_token')
        expect(capturedForm?.get('refresh_token')).toBe('old-refresh-token')
        expect(capturedForm?.get('client_id')).toBe('client-123')
    })

    it('retains the previous refresh_token when the server omits one from the response', async () => {
        const deps = baseDeps()
        await deps.sessionStore.set(SESSION_ID, activeSession(), 86400)

        const result = await refreshSession(SESSION_ID, deps)

        if (isSmartError(result)) throw new Error('expected an ActiveSession')
        expect(result.tokenResponse.refresh_token).toBe('old-refresh-token')
        expect(result.tokenResponse.access_token).toBe('new-access-token')
    })

    it('replaces the refresh_token when the server issues a new one (rotation)', async () => {
        const recorder = createExchangeRecorder()
        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(
                recorder,
                () =>
                    new Response(
                        JSON.stringify({
                            access_token: 'new-access-token',
                            token_type: 'Bearer',
                            scope: 'openid',
                            refresh_token: 'rotated-refresh-token',
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } },
                    ),
            ),
        })
        await deps.sessionStore.set(SESSION_ID, activeSession(), 86400)

        const result = await refreshSession(SESSION_ID, deps)

        if (isSmartError(result)) throw new Error('expected an ActiveSession')
        expect(result.tokenResponse.refresh_token).toBe('rotated-refresh-token')
    })

    it('recomputes expiresAt from the fresh expires_in', async () => {
        const recorder = createExchangeRecorder()
        const deps = baseDeps({
            recorder,
            httpClient: httpClientWithTokenEndpoint(
                recorder,
                () =>
                    new Response(
                        JSON.stringify({
                            access_token: 'new-access-token',
                            token_type: 'Bearer',
                            scope: 'openid',
                            expires_in: 3600,
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } },
                    ),
            ),
        })
        await deps.sessionStore.set(SESSION_ID, activeSession(), 86400)

        const result = await refreshSession(SESSION_ID, deps)

        if (isSmartError(result)) throw new Error('expected an ActiveSession')
        expect(result.expiresAt).toBe(new Date('2024-01-01T01:10:00.000Z').toISOString())
    })

    it('accumulates and caps the exchanges array, persisting with the active-session TTL', async () => {
        const recorder = createExchangeRecorder()
        const sessionStore = createInMemorySessionStore()
        const setSpy = vi.spyOn(sessionStore, 'set')
        const deps = baseDeps({ recorder, httpClient: httpClientWithTokenEndpoint(recorder), sessionStore })
        const priorExchange = {
            id: 'prior-1',
            phase: 'token' as const,
            request: { method: 'POST', url: TOKEN_ENDPOINT, headers: {} },
            response: { status: 200, statusText: 'OK', headers: {}, body: {} },
            error: null,
            startedAt: new Date().toISOString(),
            durationMs: 5,
        }
        await sessionStore.set(SESSION_ID, activeSession({ exchanges: [priorExchange] }), 86400)

        const result = await refreshSession(SESSION_ID, deps)

        if (isSmartError(result)) throw new Error('expected an ActiveSession')
        expect(result.exchanges.some((exchange) => exchange.id === 'prior-1')).toBe(true)
        expect(result.exchanges.length).toBeGreaterThan(1)
        expect(setSpy).toHaveBeenCalledWith(SESSION_ID, expect.anything(), 86400)
    })
})
