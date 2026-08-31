import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { HttpExchange } from '#core/http/exchange'
import type { ActiveSession, PendingSession } from '#core/smart/types'

import {
    capExchanges,
    createInMemorySessionStore,
    createSessionStore,
    MAX_STORED_EXCHANGES,
    MAX_STORED_SESSIONS,
    parseStoredSession,
    resetSessionStoreForTests,
} from './session-store'

function exchange(overrides: Partial<HttpExchange> = {}): HttpExchange {
    return {
        id: 'exchange-1',
        phase: 'discovery',
        request: {
            method: 'GET',
            url: 'https://ehr.example.com/.well-known/smart-configuration',
            headers: {},
        },
        response: { status: 200, statusText: 'OK', headers: {}, body: {} },
        error: null,
        startedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        durationMs: 12,
        ...overrides,
    }
}

function pendingSession(overrides: Partial<PendingSession> = {}): PendingSession {
    return {
        state: 'pending',
        sessionId: 'session-1',
        fhirBaseUrl: 'https://ehr.example.com/fhir',
        clientId: 'client-123',
        oauthState: 'state-abc',
        codeVerifier: 'verifier-abc',
        launch: 'launch-xyz',
        requestedScope: 'openid launch',
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        exchanges: [],
        ...overrides,
    }
}

function activeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
    return {
        state: 'active',
        sessionId: 'session-1',
        fhirBaseUrl: 'https://ehr.example.com/fhir',
        clientId: 'client-123',
        requestedScope: 'openid launch',
        tokenResponse: { access_token: 'tok', token_type: 'Bearer', scope: 'openid launch' },
        expiresAt: new Date('2024-01-01T01:00:00.000Z').toISOString(),
        idTokenClaims: null,
        smartConfiguration: { issuer: 'https://ehr.example.com' },
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        exchanges: [],
        ...overrides,
    }
}

describe('capExchanges', () => {
    it('keeps the array unchanged when at or below the cap', () => {
        const exchanges = [exchange({ id: '1' }), exchange({ id: '2' })]
        expect(capExchanges(exchanges)).toEqual(exchanges)
    })

    it('keeps only the most recent MAX_STORED_EXCHANGES entries', () => {
        const exchanges = Array.from({ length: MAX_STORED_EXCHANGES + 10 }, (_, i) =>
            exchange({ id: `${i}` }),
        )
        const capped = capExchanges(exchanges)

        expect(capped).toHaveLength(MAX_STORED_EXCHANGES)
        // The oldest entries are dropped; the most recent ones (highest ids) are kept.
        expect(capped[0]?.id).toBe('10')
        expect(capped[capped.length - 1]?.id).toBe(`${MAX_STORED_EXCHANGES + 9}`)
    })

    it('does not mutate the input array', () => {
        const exchanges = [exchange({ id: '1' })]
        capExchanges(exchanges)
        expect(exchanges).toHaveLength(1)
    })
})

describe('parseStoredSession', () => {
    it('accepts a valid pending session', () => {
        const session = pendingSession()
        expect(parseStoredSession(session)).toEqual(session)
    })

    it('accepts a valid active session, including unknown token response fields', () => {
        const session = activeSession({
            tokenResponse: {
                access_token: 'tok',
                token_type: 'Bearer',
                scope: 'openid',
                // A vendor extension not in the TokenResponse type: should be preserved, not stripped.
                vendor_extension: 'x',
            } as ActiveSession['tokenResponse'],
        })

        const result = parseStoredSession(session)
        expect(result).not.toBeNull()
        expect(
            (result?.state === 'active' ? result.tokenResponse : undefined) as unknown as Record<
                string,
                unknown
            >,
        ).toMatchObject({
            vendor_extension: 'x',
        })
    })

    it('rejects a value with an unknown discriminator', () => {
        expect(parseStoredSession({ state: 'bogus' })).toBeNull()
    })

    it('rejects a pending session missing a required field, rather than throwing', () => {
        const { oauthState: _oauthState, ...corrupt } = pendingSession()
        expect(() => parseStoredSession(corrupt)).not.toThrow()
        expect(parseStoredSession(corrupt)).toBeNull()
    })

    it('rejects a completely malformed value', () => {
        expect(parseStoredSession('not even an object')).toBeNull()
        expect(parseStoredSession(null)).toBeNull()
        expect(parseStoredSession(undefined)).toBeNull()
    })

    it('rejects an active session whose token response is missing a required field', () => {
        const corrupt = { ...activeSession(), tokenResponse: { token_type: 'Bearer', scope: 'openid' } }
        expect(parseStoredSession(corrupt)).toBeNull()
    })
})

describe('createInMemorySessionStore', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('round-trips a session that was just set', async () => {
        const store = createInMemorySessionStore()
        const session = pendingSession()

        await store.set(session.sessionId, session, 600)

        expect(await store.get(session.sessionId)).toEqual(session)
    })

    it('returns null for a session id that was never set', async () => {
        const store = createInMemorySessionStore()
        expect(await store.get('unknown')).toBeNull()
    })

    it('expires a session once its TTL has elapsed', async () => {
        const store = createInMemorySessionStore()
        const session = pendingSession()
        await store.set(session.sessionId, session, 10)

        vi.advanceTimersByTime(9_000)
        expect(await store.get(session.sessionId)).not.toBeNull()

        vi.advanceTimersByTime(2_000)
        expect(await store.get(session.sessionId)).toBeNull()
    })

    it('delete removes a session immediately', async () => {
        const store = createInMemorySessionStore()
        const session = pendingSession()
        await store.set(session.sessionId, session, 600)

        await store.delete(session.sessionId)

        expect(await store.get(session.sessionId)).toBeNull()
    })

    it('caps the exchanges array on write', async () => {
        const store = createInMemorySessionStore()
        const many = Array.from({ length: MAX_STORED_EXCHANGES + 5 }, (_, i) => exchange({ id: `${i}` }))
        const session = pendingSession({ exchanges: many })

        await store.set(session.sessionId, session, 600)
        const stored = await store.get(session.sessionId)

        expect(stored?.exchanges).toHaveLength(MAX_STORED_EXCHANGES)
    })

    it('never holds more than MAX_STORED_SESSIONS entries at once', async () => {
        const store = createInMemorySessionStore()

        for (let i = 0; i < MAX_STORED_SESSIONS + 10; i++) {
            await store.set(`session-${i}`, pendingSession({ sessionId: `session-${i}` }), 600)
        }

        let live = 0
        for (let i = 0; i < MAX_STORED_SESSIONS + 10; i++) {
            if ((await store.get(`session-${i}`)) !== null) live++
        }
        expect(live).toBe(MAX_STORED_SESSIONS)
    })

    it('evicts the oldest session once the cap is exceeded', async () => {
        const store = createInMemorySessionStore()

        for (let i = 0; i < MAX_STORED_SESSIONS; i++) {
            await store.set(`session-${i}`, pendingSession({ sessionId: `session-${i}` }), 600)
        }
        // All sessions share the same TTL, so none has expired yet: the very next write must evict
        // the oldest (first-written) entry rather than picking an arbitrary one.
        await store.set('session-overflow', pendingSession({ sessionId: 'session-overflow' }), 600)

        expect(await store.get('session-0')).toBeNull()
        expect(await store.get('session-1')).not.toBeNull()
        expect(await store.get('session-overflow')).not.toBeNull()
    })

    it('prefers evicting an already-expired session over a live one, even if the live one is older', async () => {
        const store = createInMemorySessionStore()

        // The oldest entry (session-0) is given a long TTL, so it's still live when the cap is
        // hit. A later entry is given a short TTL and left to expire before the store fills up.
        await store.set('session-0', pendingSession({ sessionId: 'session-0' }), 600)
        await store.set('session-expiring', pendingSession({ sessionId: 'session-expiring' }), 5)

        for (let i = 1; i < MAX_STORED_SESSIONS - 1; i++) {
            await store.set(`session-${i}`, pendingSession({ sessionId: `session-${i}` }), 600)
        }
        // Store is now at capacity: session-0 (live, oldest), session-expiring (about to expire),
        // session-1..session-(MAX-2) (live).

        vi.advanceTimersByTime(6_000)
        // session-expiring has now expired, but nothing has read it yet, so it's still sitting in
        // the map as dead weight.

        await store.set('session-overflow', pendingSession({ sessionId: 'session-overflow' }), 600)

        // The expired entry was reclaimed, not the older-but-live session-0.
        expect(await store.get('session-expiring')).toBeNull()
        expect(await store.get('session-0')).not.toBeNull()
        expect(await store.get('session-overflow')).not.toBeNull()
    })
})

describe('createSessionStore', () => {
    beforeEach(() => {
        resetSessionStoreForTests()
    })

    afterEach(() => {
        resetSessionStoreForTests()
    })

    it('creates a working in-memory store', async () => {
        const store = await createSessionStore()
        const session = pendingSession()
        await store.set(session.sessionId, session, 600)

        expect(await store.get(session.sessionId)).toEqual(session)
    })

    it('returns the same store to every caller, so a session written by one request is readable by the next', async () => {
        // A launch and its callback are separate requests that each ask for a store; a fresh
        // store per call would leave the callback unable to find the pending session.
        const duringLaunch = await createSessionStore()
        const session = pendingSession()
        await duringLaunch.set(session.sessionId, session, 600)

        const duringCallback = await createSessionStore()

        expect(duringCallback).toBe(duringLaunch)
        expect(await duringCallback.get(session.sessionId)).toEqual(session)
    })

    it('constructs the backend only once even when called concurrently', async () => {
        const [first, second] = await Promise.all([createSessionStore(), createSessionStore()])

        expect(first).toBe(second)
    })
})
