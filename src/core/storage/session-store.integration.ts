import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HttpExchange } from '#core/http/exchange'
import type { ActiveSession, PendingSession } from '#core/smart/types'

import { capExchanges, MAX_STORED_EXCHANGES } from './session-store'
import { createValkeySessionStore, type ValkeyLike } from './valkey'

/**
 * `session-store.test.ts` (owned by another agent, not touched here) exercises
 * `createValkeySessionStore` against `createFakeValkeyClient`, but that fake is a bare
 * `Map` — it records the `EX` argument passed to `set` without ever honouring it, so it
 * cannot prove a session actually disappears once its TTL elapses, and it never runs
 * concurrent operations. Both are exactly the failure modes that matter for a session
 * store: an unenforced TTL means expired vendor credentials could be resurrected from
 * storage, and a concurrency bug could corrupt or leak one launch's session into another's.
 *
 * This file plugs that gap with a faithful fake: real expiry bookkeeping keyed off an
 * injectable clock (`vi.setSystemTime`, never a real sleep), so the Valkey-backed path's
 * TTL semantics are proven end-to-end rather than merely "the right arguments were passed".
 *
 * We do not stand up a real Valkey/Redis server. `ValkeyLike` is a 3-method structural
 * interface (`get`/`set`/`del`) chosen specifically so it can be faithfully faked; running
 * an actual server would trade a fast, deterministic CI check for a flaky, environment
 * -dependent one without covering anything this fake does not already cover (this app never
 * uses Valkey transactions, pub/sub, or any command beyond these three). That trade is
 * called out explicitly here rather than silently claimed as "real Valkey" coverage.
 */

class FaithfulFakeValkey implements ValkeyLike {
    private readonly entries = new Map<string, { value: string; expiresAtMs: number }>()

    get(key: string): Promise<string | null> {
        const entry = this.entries.get(key)
        if (!entry) return Promise.resolve(null)

        if (entry.expiresAtMs <= Date.now()) {
            // Real Valkey/Redis drops a key lazily-or-actively once its EX elapses; a get
            // afterwards never sees it. Mirror that instead of only checking wall-clock time
            // in a helper method, so the store-under-test observes exactly what production does.
            this.entries.delete(key)
            return Promise.resolve(null)
        }

        return Promise.resolve(entry.value)
    }

    set(key: string, value: string, _secondsToken: 'EX', seconds: number): Promise<'OK' | null> {
        this.entries.set(key, { value, expiresAtMs: Date.now() + seconds * 1000 })
        return Promise.resolve('OK')
    }

    del(key: string): Promise<number> {
        const existed = this.entries.has(key)
        this.entries.delete(key)
        return Promise.resolve(existed ? 1 : 0)
    }

    /** Test-only introspection, not part of `ValkeyLike`. */
    get size(): number {
        return this.entries.size
    }
}

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
        tokenResponse: {
            access_token: 'super-secret-access-token',
            token_type: 'Bearer',
            scope: 'openid launch',
        },
        expiresAt: new Date('2024-01-01T01:00:00.000Z').toISOString(),
        idTokenClaims: null,
        smartConfiguration: { issuer: 'https://ehr.example.com' },
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        exchanges: [],
        ...overrides,
    }
}

describe('Valkey-backed session store: TTL is actually enforced, not just requested', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('a session set with a 10s TTL round-trips before expiry and vanishes after it', async () => {
        const store = createValkeySessionStore(new FaithfulFakeValkey())
        const session = pendingSession()

        await store.set(session.sessionId, session, 10)

        vi.setSystemTime(new Date('2024-01-01T00:00:09.000Z'))
        expect(await store.get(session.sessionId)).toEqual(session)

        vi.setSystemTime(new Date('2024-01-01T00:00:11.000Z'))
        expect(await store.get(session.sessionId)).toBeNull()
    })

    it('a re-set on the same session id refreshes its TTL from the moment of the write', async () => {
        const client = new FaithfulFakeValkey()
        const store = createValkeySessionStore(client)
        const session = pendingSession()

        await store.set(session.sessionId, session, 10)
        vi.setSystemTime(new Date('2024-01-01T00:00:08.000Z'))
        // Renew before the first TTL would have expired it.
        await store.set(session.sessionId, session, 10)

        vi.setSystemTime(new Date('2024-01-01T00:00:16.000Z'))
        // 16s after the original write, but only 8s after the renewal: still alive.
        expect(await store.get(session.sessionId)).toEqual(session)

        vi.setSystemTime(new Date('2024-01-01T00:00:19.000Z'))
        expect(await store.get(session.sessionId)).toBeNull()
    })

    it('an expired session cannot be resurrected merely by reading it again', async () => {
        const client = new FaithfulFakeValkey()
        const store = createValkeySessionStore(client)
        const session = pendingSession()

        await store.set(session.sessionId, session, 5)
        vi.setSystemTime(new Date('2024-01-01T00:00:06.000Z'))

        expect(await store.get(session.sessionId)).toBeNull()
        expect(await store.get(session.sessionId)).toBeNull()
        expect(client.size).toBe(0)
    })
})

describe('Valkey-backed session store: concurrent access', () => {
    it('concurrent writes to distinct session ids never leak state into one another', async () => {
        const store = createValkeySessionStore(new FaithfulFakeValkey())
        const sessionIds = Array.from({ length: 50 }, (_, i) => `session-${i}`)

        await Promise.all(
            sessionIds.map((id) =>
                store.set(id, pendingSession({ sessionId: id, clientId: `client-${id}` }), 600),
            ),
        )

        const results = await Promise.all(sessionIds.map((id) => store.get(id)))

        results.forEach((result, i) => {
            expect(result?.sessionId).toBe(sessionIds[i])
            expect(result?.clientId).toBe(`client-${sessionIds[i]}`)
        })
    })

    it('concurrent reads of the same session id all see a consistent, non-corrupted value', async () => {
        const store = createValkeySessionStore(new FaithfulFakeValkey())
        const session = activeSession()
        await store.set(session.sessionId, session, 600)

        const results = await Promise.all(Array.from({ length: 20 }, () => store.get(session.sessionId)))

        for (const result of results) expect(result).toEqual(session)
    })

    it('the last of several concurrent writes to the same session id wins cleanly', async () => {
        const store = createValkeySessionStore(new FaithfulFakeValkey())
        const sessionId = 'shared-session'
        const writes = Array.from({ length: 10 }, (_, i) =>
            pendingSession({ sessionId, oauthState: `state-${i}` }),
        )

        await Promise.all(writes.map((session) => store.set(sessionId, session, 600)))
        const stored = await store.get(sessionId)

        // JS's single-threaded event loop means these "concurrent" writes still resolve in a
        // well-defined order; the property under test is that the store never merges two
        // writes into a Frankenstein record, only ever a complete, valid one of them.
        expect(stored).not.toBeNull()
        expect(stored?.state).toBe('pending')
        expect(writes.some((w) => stored?.state === 'pending' && w.oauthState === stored.oauthState)).toBe(
            true,
        )
    })

    it('a concurrent delete racing a read never returns a partially-removed session', async () => {
        const store = createValkeySessionStore(new FaithfulFakeValkey())
        const session = pendingSession()
        await store.set(session.sessionId, session, 600)

        const [readResult] = await Promise.all([
            store.get(session.sessionId),
            store.delete(session.sessionId),
        ])

        // Whichever operation the fake's microtask ordering resolves first, the read must
        // return either the whole session or nothing — never a thrown error or a partial value.
        expect(readResult === null || readResult?.sessionId === session.sessionId).toBe(true)
        expect(await store.get(session.sessionId)).toBeNull()
    })
})

describe('Valkey-backed session store: exchange-list cap under load', () => {
    it('caps stored exchanges to MAX_STORED_EXCHANGES even when writes race', async () => {
        const store = createValkeySessionStore(new FaithfulFakeValkey())
        const sessionId = 'growing-session'
        const batches = Array.from({ length: 5 }, (_outer, batch) =>
            Array.from({ length: 50 }, (_inner, i) => exchange({ id: `batch-${batch}-${i}` })),
        )

        await Promise.all(
            batches.map((batch) =>
                store.set(sessionId, pendingSession({ sessionId, exchanges: batch }), 600),
            ),
        )

        const stored = await store.get(sessionId)
        expect(stored?.exchanges.length).toBeLessThanOrEqual(MAX_STORED_EXCHANGES)
    })

    it('capExchanges itself keeps only the most recent entries regardless of batch size', () => {
        const many = Array.from({ length: MAX_STORED_EXCHANGES * 3 }, (_, i) => exchange({ id: `${i}` }))
        const capped = capExchanges(many)

        expect(capped).toHaveLength(MAX_STORED_EXCHANGES)
        expect(capped[0]?.id).toBe(`${MAX_STORED_EXCHANGES * 2}`)
        expect(capped.at(-1)?.id).toBe(`${MAX_STORED_EXCHANGES * 3 - 1}`)
    })
})

describe('Valkey-backed session store: credential handling at the storage boundary', () => {
    it('stores the token response as opaque JSON without transforming or dropping the access token', async () => {
        // The session store is not responsible for redaction — that is `redact.ts`'s job, applied
        // to `HttpExchange`s before they are ever recorded (see `report-security.integration.ts`).
        // A session's `tokenResponse` is the credential the app actually replays against the EHR,
        // so the store must round-trip it byte-for-byte; silently mangling or truncating it would
        // break every subsequent FHIR call for that session.
        const store = createValkeySessionStore(new FaithfulFakeValkey())
        const session = activeSession()

        await store.set(session.sessionId, session, 600)
        const stored = await store.get(session.sessionId)

        expect(stored?.state).toBe('active')
        if (stored?.state !== 'active') throw new Error('expected an active session')
        expect(stored.tokenResponse.access_token).toBe('super-secret-access-token')
    })
})
