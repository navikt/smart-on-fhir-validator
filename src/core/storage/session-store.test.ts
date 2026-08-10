import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { HttpExchange } from '#core/http/exchange'
import type { ActiveSession, PendingSession } from '#core/smart/types'

import {
    capExchanges,
    createInMemorySessionStore,
    createSessionStore,
    MAX_STORED_EXCHANGES,
    parseStoredSession,
    resetSessionStoreForTests,
} from './session-store'
import { createValkeySessionStore, type ValkeyLike } from './valkey'

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
        issuer: 'https://ehr.example.com',
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
        issuer: 'https://ehr.example.com',
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
                // A vendor extension not in the TokenResponse type — should be preserved, not stripped.
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
})

/** A minimal in-memory fake of the `ValkeyLike` surface, so this store is tested hermetically. */
function createFakeValkeyClient(): ValkeyLike & { store: Map<string, string> } {
    const store = new Map<string, string>()

    return {
        store,
        get: (key) => Promise.resolve(store.get(key) ?? null),
        set: (key, value) => {
            store.set(key, value)
            return Promise.resolve('OK')
        },
        del: (key) => {
            const existed = store.delete(key)
            return Promise.resolve(existed ? 1 : 0)
        },
    }
}

describe('createValkeySessionStore', () => {
    it('round-trips a session through JSON serialisation', async () => {
        const client = createFakeValkeyClient()
        const store = createValkeySessionStore(client)
        const session = activeSession()

        await store.set(session.sessionId, session, 3600)

        expect(await store.get(session.sessionId)).toEqual(session)
    })

    it('prefixes keys so session ids cannot collide with unrelated Valkey keys', async () => {
        const client = createFakeValkeyClient()
        const store = createValkeySessionStore(client)
        const session = pendingSession()

        await store.set(session.sessionId, session, 600)

        expect([...client.store.keys()]).toEqual([`smart-session:${session.sessionId}`])
    })

    it('passes the TTL through as an EX expiry', async () => {
        const client = createFakeValkeyClient()
        const setSpy = vi.spyOn(client, 'set')
        const store = createValkeySessionStore(client)

        await store.set('id', pendingSession(), 123)

        expect(setSpy).toHaveBeenCalledWith('smart-session:id', expect.any(String), 'EX', 123)
    })

    it('treats a missing key as a cache miss', async () => {
        const client = createFakeValkeyClient()
        const store = createValkeySessionStore(client)

        expect(await store.get('missing')).toBeNull()
    })

    it('treats a value that is not valid JSON as a cache miss rather than throwing', async () => {
        const client = createFakeValkeyClient()
        client.store.set('smart-session:corrupt', '{not json')
        const store = createValkeySessionStore(client)

        await expect(store.get('corrupt')).resolves.toBeNull()
    })

    it('treats valid JSON that fails schema validation as a cache miss', async () => {
        const client = createFakeValkeyClient()
        client.store.set('smart-session:corrupt', JSON.stringify({ state: 'pending' }))
        const store = createValkeySessionStore(client)

        expect(await store.get('corrupt')).toBeNull()
    })

    it('caps the exchanges array on write', async () => {
        const client = createFakeValkeyClient()
        const store = createValkeySessionStore(client)
        const many = Array.from({ length: MAX_STORED_EXCHANGES + 5 }, (_, i) => exchange({ id: `${i}` }))

        await store.set('id', pendingSession({ exchanges: many }), 600)
        const stored = await store.get('id')

        expect(stored?.exchanges).toHaveLength(MAX_STORED_EXCHANGES)
    })

    it('delete removes the key', async () => {
        const client = createFakeValkeyClient()
        const store = createValkeySessionStore(client)
        await store.set('id', pendingSession(), 600)

        await store.delete('id')

        expect(await store.get('id')).toBeNull()
    })
})

describe('createSessionStore', () => {
    const originalEnv = process.env.VALKEY_URI_SESSIONS

    beforeEach(() => {
        resetSessionStoreForTests()
    })

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.VALKEY_URI_SESSIONS
        else process.env.VALKEY_URI_SESSIONS = originalEnv
        resetSessionStoreForTests()
    })

    it('falls back to an in-memory store when VALKEY_URI_SESSIONS is not set', async () => {
        delete process.env.VALKEY_URI_SESSIONS

        const store = await createSessionStore()
        const session = pendingSession()
        await store.set(session.sessionId, session, 600)

        expect(await store.get(session.sessionId)).toEqual(session)
    })

    it('returns the same store to every caller, so a session written by one request is readable by the next', async () => {
        delete process.env.VALKEY_URI_SESSIONS

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
        delete process.env.VALKEY_URI_SESSIONS

        const [first, second] = await Promise.all([createSessionStore(), createSessionStore()])

        expect(first).toBe(second)
    })
})
