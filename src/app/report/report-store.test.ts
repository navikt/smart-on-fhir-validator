import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ValidationReport } from '#core/run/report'

import {
    createInMemoryReportStore,
    getReportStore,
    MAX_STORED_REPORTS,
    resetReportStoreForTests,
} from './report-store'

function report(overrides: Partial<ValidationReport> = {}): ValidationReport {
    return {
        generatedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        fhirBaseUrl: 'https://ehr.example.com/fhir',
        clientId: 'client-123',
        sections: [],
        exchanges: [],
        summary: { counts: { OK: 0, INFO: 0, WARNING: 0, ERROR: 0 }, sectionsSkipped: 0, verdict: 'pass' },
        ...overrides,
    }
}

describe('createInMemoryReportStore', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('round-trips a report that was just set', async () => {
        const store = createInMemoryReportStore()
        const stored = report()

        await store.set('session-1', stored)

        expect(await store.get('session-1')).toEqual(stored)
    })

    it('returns null for a session id that was never set', async () => {
        const store = createInMemoryReportStore()
        expect(await store.get('unknown')).toBeNull()
    })

    it('overwrites a report already stored for the same session id', async () => {
        // The callback runs the entire validation exactly once per session, but re-runs (e.g. a
        // retried launch) must still land the latest report, not an accumulation of stale ones.
        const store = createInMemoryReportStore()
        await store.set('session-1', report({ clientId: 'first-run' }))
        await store.set('session-1', report({ clientId: 'second-run' }))

        expect(await store.get('session-1')).toEqual(report({ clientId: 'second-run' }))
    })

    it('expires a report once its TTL has elapsed', async () => {
        const store = createInMemoryReportStore()
        await store.set('session-1', report())

        // TTL mirrors ACTIVE_SESSION_TTL_SECONDS (24h) in #core/smart/callback.
        vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1_000)
        expect(await store.get('session-1')).not.toBeNull()

        vi.advanceTimersByTime(2_000)
        expect(await store.get('session-1')).toBeNull()
    })

    it('keeps reports for different session ids independent', async () => {
        const store = createInMemoryReportStore()
        await store.set('session-1', report({ clientId: 'client-a' }))
        await store.set('session-2', report({ clientId: 'client-b' }))

        expect((await store.get('session-1'))?.clientId).toBe('client-a')
        expect((await store.get('session-2'))?.clientId).toBe('client-b')
    })

    it('never holds more than MAX_STORED_REPORTS entries at once', async () => {
        const store = createInMemoryReportStore()

        for (let i = 0; i < MAX_STORED_REPORTS + 10; i++) {
            await store.set(`session-${i}`, report())
        }

        let live = 0
        for (let i = 0; i < MAX_STORED_REPORTS + 10; i++) {
            if ((await store.get(`session-${i}`)) !== null) live++
        }
        expect(live).toBe(MAX_STORED_REPORTS)
    })

    it('evicts the oldest report once the cap is exceeded', async () => {
        const store = createInMemoryReportStore()

        for (let i = 0; i < MAX_STORED_REPORTS; i++) {
            await store.set(`session-${i}`, report())
        }
        // All reports share the same TTL, so none has expired yet: the very next write must evict
        // the oldest (first-written) entry rather than picking an arbitrary one.
        await store.set('session-overflow', report())

        expect(await store.get('session-0')).toBeNull()
        expect(await store.get('session-1')).not.toBeNull()
        expect(await store.get('session-overflow')).not.toBeNull()
    })

    it('prefers evicting an already-expired report over a live one, even if the live one is older', async () => {
        const store = createInMemoryReportStore()

        // Every report shares the same fixed TTL relative to when it was written, so under
        // normal circumstances the oldest entry is also the first to expire. To prove the store
        // really checks expiry (and doesn't just delete the oldest key), session-0 is refreshed
        // just before it would have expired: a `Map.set` on an existing key updates its expiry
        // without moving its position, so session-0 stays oldest by insertion order while
        // ending up with the furthest-out expiry of the batch.
        for (let i = 0; i < MAX_STORED_REPORTS; i++) {
            await store.set(`session-${i}`, report())
        }

        vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1_000)
        await store.set('session-0', report())

        // The rest of the original batch (session-1..session-(MAX-1)) now expires, while the
        // refreshed session-0 does not.
        vi.advanceTimersByTime(2_000)

        await store.set('session-overflow', report())

        // The expired session-1 was reclaimed, not the older-by-position-but-live session-0.
        expect(await store.get('session-1')).toBeNull()
        expect(await store.get('session-0')).not.toBeNull()
        expect(await store.get('session-overflow')).not.toBeNull()
    })
})

describe('getReportStore', () => {
    beforeEach(() => {
        resetReportStoreForTests()
    })

    afterEach(() => {
        resetReportStoreForTests()
    })

    it('returns the same store to every caller, so a report written in the callback is readable from /report', async () => {
        // The callback handler and the /report page each ask for a store from a separate request;
        // a fresh store per call would leave /report unable to find the report the callback wrote.
        const duringCallback = getReportStore()
        await duringCallback.set('session-1', report())

        const duringReportPage = getReportStore()

        expect(duringReportPage).toBe(duringCallback)
        expect(await duringReportPage.get('session-1')).toEqual(report())
    })

    it('constructs the backend only once even when called concurrently', () => {
        const [first, second] = [getReportStore(), getReportStore()]
        expect(first).toBe(second)
    })

    it('resetReportStoreForTests forces a fresh store, discarding anything written before', async () => {
        // Without this, a regression in resetReportStoreForTests (e.g. resetting the wrong key)
        // would go unnoticed: every other test in this file already calls it in beforeEach, so a
        // no-op reset would still leave each test's own writes isolated by coincidence.
        const before = getReportStore()
        await before.set('session-1', report())

        resetReportStoreForTests()
        const after = getReportStore()

        expect(after).not.toBe(before)
        expect(await after.get('session-1')).toBeNull()
    })
})
