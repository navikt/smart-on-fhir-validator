import { describe, expect, it, vi } from 'vitest'

import { createInMemorySessionStore, type SessionStore } from '#core/storage/session-store'
import type { ActiveSession, PendingSession } from '#core/smart/types'

import { type DebugProxyDependencies, executeDebugRequest, isDebugError } from './proxy'
import type { DebugRequest } from './request'

const SESSION_ID = 'session-1'
const BASE = 'https://ehr.example.com/fhir'
const TOKEN_ENDPOINT = 'https://ehr.example.com/oauth/token'
const NOW = new Date('2024-01-01T00:00:00.000Z')

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
    return {
        state: 'active',
        sessionId: SESSION_ID,
        fhirBaseUrl: BASE,
        clientId: 'client-1',
        requestedScope: 'openid offline_access',
        tokenResponse: {
            access_token: 'secret-access-token',
            token_type: 'Bearer',
            scope: 'openid offline_access',
            refresh_token: 'secret-refresh-token',
        },
        expiresAt: '2024-01-01T01:00:00.000Z',
        idTokenClaims: null,
        smartConfiguration: { issuer: 'https://ehr.example.com', token_endpoint: TOKEN_ENDPOINT },
        createdAt: '2024-01-01T00:00:00.000Z',
        exchanges: [],
        clientAuthMethod: 'none',
        ...overrides,
    }
}

function request(overrides: Partial<DebugRequest> = {}): DebugRequest {
    return {
        method: 'GET',
        resourceType: 'Patient',
        id: '123',
        query: '',
        body: null,
        contentType: null,
        authentication: 'session',
        customToken: null,
        ...overrides,
    }
}

type Fetch = ReturnType<typeof vi.fn<typeof fetch>>

async function setup(stored: ActiveSession | PendingSession | null, fetchImpl: Fetch) {
    const store = createInMemorySessionStore()
    if (stored) await store.set(SESSION_ID, stored, 60)
    const set = vi.spyOn(store, 'set')
    const selectClientAuthentication = vi.fn<DebugProxyDependencies['selectClientAuthentication']>(() => ({
        method: 'none',
        formFields: async () => ({ client_id: 'client-1' }),
        headers: async () => ({}),
    }))
    const findIssuerConfig = vi.fn<DebugProxyDependencies['findIssuerConfig']>(() => null)
    const deps: DebugProxyDependencies = {
        sessionStore: store as SessionStore,
        findIssuerConfig,
        selectClientAuthentication,
        fetchImpl: fetchImpl as typeof fetch,
        now: () => NOW,
    }

    return { store, set, deps, selectClientAuthentication, findIssuerConfig }
}

const fhirResponse = () =>
    new Response(JSON.stringify({ resourceType: 'Patient', id: '123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/fhir+json' },
    })

const authorizationOf = (fetchImpl: Fetch): unknown =>
    new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('Authorization')

describe('executeDebugRequest', () => {
    it('rejects a missing session', async () => {
        const fetchImpl: Fetch = vi.fn<typeof fetch>()
        const { deps } = await setup(null, fetchImpl)

        expect(await executeDebugRequest(SESSION_ID, request(), deps)).toMatchObject({ error: 'no_session' })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('rejects a pending session', async () => {
        const pending: PendingSession = {
            state: 'pending',
            sessionId: SESSION_ID,
            fhirBaseUrl: BASE,
            clientId: 'client-1',
            oauthState: 'state',
            codeVerifier: 'verifier',
            launch: 'launch',
            requestedScope: 'openid',
            createdAt: '2024-01-01T00:00:00.000Z',
            exchanges: [],
        }
        const fetchImpl: Fetch = vi.fn<typeof fetch>()
        const { deps } = await setup(pending, fetchImpl)

        expect(await executeDebugRequest(SESSION_ID, request(), deps)).toMatchObject({ error: 'no_session' })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('rejects an invalid request without calling the server', async () => {
        const fetchImpl: Fetch = vi.fn<typeof fetch>()
        const { deps } = await setup(session(), fetchImpl)

        const result = await executeDebugRequest(SESSION_ID, request({ id: '..' }), deps)

        expect(result).toMatchObject({ error: 'invalid_request' })
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('sends the call with fixed headers, manual redirect and without touching the session store', async () => {
        const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => fhirResponse())
        const { deps, set } = await setup(session(), fetchImpl)

        const result = await executeDebugRequest(
            SESSION_ID,
            request({
                method: 'post',
                resourceType: 'Patient',
                id: '',
                query: 'a=b c',
                body: '{}',
                contentType: 'application/fhir+json',
            }),
            deps,
        )

        expect(isDebugError(result)).toBe(false)
        const [url, init] = fetchImpl.mock.calls[0] ?? []
        expect(url).toBe(`${BASE}/Patient?a=b+c`)
        expect(init).toMatchObject({
            method: 'POST',
            redirect: 'manual',
            body: '{}',
            headers: {
                Authorization: 'Bearer secret-access-token',
                Accept: 'application/fhir+json',
                'Content-Type': 'application/fhir+json',
            },
        })
        expect(set).not.toHaveBeenCalled()
        expect((await deps.sessionStore.get(SESSION_ID)) as ActiveSession).toMatchObject({ exchanges: [] })
    })

    it('redacts the credential in the returned exchange but keeps FHIR code', async () => {
        const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => fhirResponse())
        const { deps } = await setup(session(), fetchImpl)

        const result = await executeDebugRequest(
            SESSION_ID,
            request({ resourceType: 'Condition', id: '', query: 'code=http://snomed|1' }),
            deps,
        )

        expect(isDebugError(result)).toBe(false)
        const serialised = JSON.stringify(result)
        expect(serialised).not.toContain('secret-access-token')
        expect(serialised).not.toContain('secret-refresh-token')
        expect(serialised).toContain('code=http')
    })

    it('shows a redirect without following it', async () => {
        const fetchImpl: Fetch = vi.fn<typeof fetch>(
            async () =>
                new Response(null, { status: 302, headers: { Location: 'https://evil.example.com/' } }),
        )
        const { deps } = await setup(session(), fetchImpl)

        const result = await executeDebugRequest(SESSION_ID, request(), deps)

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(isDebugError(result) ? null : result.exchange.response).toMatchObject({
            status: 302,
            headers: { location: 'https://evil.example.com/' },
        })
    })

    it('reports truncation of an oversized response', async () => {
        const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => new Response('x'.repeat(1024 * 1024 + 1)))
        const { deps } = await setup(session(), fetchImpl)

        const result = await executeDebugRequest(SESSION_ID, request(), deps)

        expect(isDebugError(result) ? null : result.bodyTruncated).toBe(true)
    })

    it('returns a transport failure as an exchange', async () => {
        const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => {
            throw new Error('connection refused')
        })
        const { deps } = await setup(session(), fetchImpl)

        const result = await executeDebugRequest(SESSION_ID, request(), deps)

        expect(isDebugError(result) ? null : result.exchange.error).toContain('connection refused')
    })

    describe('authentication modes', () => {
        const expired = { expiresAt: '2023-12-31T00:00:00.000Z' }
        const custom = { authentication: 'custom', customToken: 'custom-abc' } as const

        it('omits Authorization for none and defaults an omitted mode to the session token', async () => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => fhirResponse())
            const { deps } = await setup(session(), fetchImpl)

            await executeDebugRequest(SESSION_ID, request({ authentication: 'none' }), deps)
            expect(authorizationOf(fetchImpl)).toBeNull()
            expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })

            const { authentication: _a, customToken: _c, ...legacy } = request()
            fetchImpl.mockClear()
            await executeDebugRequest(SESSION_ID, legacy, deps)
            expect(authorizationOf(fetchImpl)).toBe('Bearer secret-access-token')
        })

        it('sends the custom token but redacts it in the exchange', async () => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => fhirResponse())
            const { deps } = await setup(session(), fetchImpl)

            const result = await executeDebugRequest(SESSION_ID, request(custom), deps)

            expect(authorizationOf(fetchImpl)).toBe('Bearer custom-abc')
            expect(JSON.stringify(result)).not.toContain('custom-abc')
            expect(JSON.stringify(result)).not.toContain('secret-access-token')
        })

        it.each([
            ['none', { authentication: 'none' }],
            ['custom', custom],
        ] as const)('does not refresh an expired session in %s mode', async (_name, overrides) => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => fhirResponse())
            const { deps, set } = await setup(session(expired), fetchImpl)

            const result = await executeDebugRequest(SESSION_ID, request(overrides), deps)

            expect(isDebugError(result)).toBe(false)
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`${BASE}/Patient/123`)
            expect(set).not.toHaveBeenCalled()
        })

        it.each([
            ['none', { authentication: 'none' }],
            ['custom', custom],
        ] as const)('still requires an active session in %s mode', async (_name, overrides) => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>()
            const { deps } = await setup(null, fetchImpl)

            expect(await executeDebugRequest(SESSION_ID, request(overrides), deps)).toMatchObject({
                error: 'no_session',
            })
            expect(fetchImpl).not.toHaveBeenCalled()
        })
    })

    describe('expiry', () => {
        const expiring = { expiresAt: '2024-01-01T00:00:29.000Z' }

        it('does not refresh just outside the 30 second margin', async () => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => fhirResponse())
            const { deps, set } = await setup(session({ expiresAt: '2024-01-01T00:00:31.000Z' }), fetchImpl)

            await executeDebugRequest(SESSION_ID, request(), deps)

            expect(set).not.toHaveBeenCalled()
        })

        it('returns 401 text without a refresh token', async () => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>()
            const { deps } = await setup(
                session({
                    ...expiring,
                    tokenResponse: { access_token: 'a', token_type: 'Bearer', scope: 'openid' },
                }),
                fetchImpl,
            )

            expect(await executeDebugRequest(SESSION_ID, request(), deps)).toEqual({
                error: 'session_expired',
                detail: 'Your access token has expired. Launch again from your EHR.',
            })
            expect(fetchImpl).not.toHaveBeenCalled()
        })

        it('refreshes with the dynamic public fallback and uses the new token', async () => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>(async (input) =>
                String(input) === TOKEN_ENDPOINT
                    ? Response.json({
                          access_token: 'new-access-token',
                          token_type: 'Bearer',
                          scope: 'openid offline_access',
                          expires_in: 3600,
                      })
                    : fhirResponse(),
            )
            const { deps, set, store, findIssuerConfig, selectClientAuthentication } = await setup(
                session(expiring),
                fetchImpl,
            )

            const result = await executeDebugRequest(SESSION_ID, request(), deps)

            expect(isDebugError(result)).toBe(false)
            expect(findIssuerConfig).toHaveBeenCalledWith(BASE)
            expect(selectClientAuthentication).toHaveBeenCalledWith(
                'client-1',
                { type: 'public' },
                TOKEN_ENDPOINT,
            )
            const fhirCall = fetchImpl.mock.calls.find(([url]) => String(url).startsWith(BASE))
            expect(fhirCall?.[1]).toMatchObject({ headers: { Authorization: 'Bearer new-access-token' } })

            expect(set).toHaveBeenCalledTimes(1)
            const stored = (await store.get(SESSION_ID)) as ActiveSession
            expect(stored.exchanges.map((exchange) => exchange.phase)).toEqual(['token'])
            expect(JSON.stringify(result)).not.toContain('new-access-token')
        })

        it('uses the configured issuer client authentication', async () => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => new Response('', { status: 400 }))
            const { deps, selectClientAuthentication, findIssuerConfig } = await setup(
                session(expiring),
                fetchImpl,
            )
            const auth = { type: 'confidential-symmetric', clientSecret: 's' } as never
            findIssuerConfig.mockReturnValue({
                fhirBaseUrl: BASE,
                clientId: 'configured',
                auth,
                dynamicallyRegistered: false,
            })

            await executeDebugRequest(SESSION_ID, request(), deps)

            expect(selectClientAuthentication).toHaveBeenCalledWith('configured', auth, TOKEN_ENDPOINT)
        })

        it('returns 401 text when the refresh fails, without calling FHIR', async () => {
            const fetchImpl: Fetch = vi.fn<typeof fetch>(async () => new Response('', { status: 400 }))
            const { deps, set } = await setup(session(expiring), fetchImpl)

            const result = await executeDebugRequest(SESSION_ID, request(), deps)

            expect(result).toMatchObject({ error: 'session_expired' })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            expect(set).not.toHaveBeenCalled()
        })
    })
})
