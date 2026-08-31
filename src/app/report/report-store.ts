/**
 * Storage for a completed `ValidationReport`, keyed by the opaque session id carried in the
 * session cookie.
 *
 * Deliberately a separate store from `#core/storage/session-store`: a report is a derived
 * artefact, produced exactly once per run so that re-visiting `/report` never re-triggers
 * write-back probes against a real EHR.
 *
 * A `ValidationReport` never carries credentials: every `HttpExchange` inside it was redacted at
 * recording time (`#core/http/redact`), so serving it verbatim to the browser is safe.
 */

import type { ValidationReport } from '#core/run'
import { processSingleton, resetProcessSingleton } from '#core/storage/process-singleton'

const REPORT_STORE_KEY = 'report-store'

/** Mirrors `ACTIVE_SESSION_TTL_SECONDS` in `#core/smart/callback`: a report is only useful for as
 * long as the session it was produced from would still be active. */
const REPORT_TTL_SECONDS = 60 * 60 * 24

/**
 * Hard cap on the number of reports held at once, to bound the store's worst-case footprint
 * against the pod's 1024Mi memory limit.
 *
 * Unlike the session store, this one is only reachable after a completed callback -- a much
 * smaller attack surface -- but each report still carries its own copy of the exchange evidence
 * (up to `MAX_STORED_EXCHANGES`, see `#core/storage/session-store`), full HTTP bodies included,
 * and it's kept for the full `REPORT_TTL_SECONDS` (24h), so it can't be relied on to age out
 * quickly either.
 *
 * Using the same ~10KB-per-exchange average reasoned about in
 * `MAX_STORED_SESSIONS`, a fully-capped report costs about
 * `MAX_STORED_EXCHANGES * 10KB` ~= 2MB. Reserving roughly 5% of the 1024Mi limit (~50MB) for
 * this lower-risk store yields `50MB / 2MB` ~= 25 reports.
 */
export const MAX_STORED_REPORTS = 25

export type ReportStore = {
    get(sessionId: string): Promise<ValidationReport | null>
    set(sessionId: string, report: ValidationReport): Promise<void>
}

/** Exported so tests can exercise the store's own logic (TTL, expiry) on a fresh instance,
 * without going through the `globalThis` singleton `getReportStore()` anchors on. */
export function createInMemoryReportStore(): ReportStore {
    const reports = new Map<string, { report: ValidationReport; expiresAt: number }>()

    /**
     * Frees up room for one more entry when the store is full.
     *
     * An already-expired report is worthless, so reclaiming it costs nothing; evicting a live one
     * throws away a run a vendor may still want to read. So: sweep for the first expired entry
     * and drop that, and only fall back to the oldest live entry (the first key in insertion
     * order -- a `Map` preserves insertion order, and entries are never re-inserted on `get`, so
     * this is oldest-write, not least-recently-used) if nothing has expired yet.
     */
    function evictOne(): void {
        const now = Date.now()
        for (const [sessionId, entry] of reports) {
            if (entry.expiresAt <= now) {
                reports.delete(sessionId)
                return
            }
        }

        const oldestSessionId = reports.keys().next().value
        if (oldestSessionId !== undefined) reports.delete(oldestSessionId)
    }

    return {
        get(sessionId) {
            const entry = reports.get(sessionId)
            if (!entry) return Promise.resolve(null)

            if (entry.expiresAt <= Date.now()) {
                reports.delete(sessionId)
                return Promise.resolve(null)
            }

            return Promise.resolve(entry.report)
        },
        set(sessionId, report) {
            // Overwriting an existing key doesn't grow the map, so it never needs to evict.
            if (!reports.has(sessionId) && reports.size >= MAX_STORED_REPORTS) {
                evictOne()
            }

            reports.set(sessionId, { report, expiresAt: Date.now() + REPORT_TTL_SECONDS * 1000 })
            return Promise.resolve()
        },
    }
}

/** Must be anchored on `globalThis`; see `#core/storage/process-singleton`. */
export function getReportStore(): ReportStore {
    return processSingleton(REPORT_STORE_KEY, createInMemoryReportStore)
}

/** Test-only: forgets the singleton so the next `getReportStore()` call builds a fresh store. */
export function resetReportStoreForTests(): void {
    resetProcessSingleton(REPORT_STORE_KEY)
}
