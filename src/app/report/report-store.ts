/**
 * Storage for a completed `ValidationReport`, keyed by the opaque session id carried in the
 * session cookie.
 *
 * This is deliberately a second store rather than an extension of `#core/storage/session-store`:
 * that module's schema is fixed to `PendingSession | ActiveSession` (see `smartSessionSchema`),
 * and a report is not a `SmartSession` — it is this app's own derived artefact, produced exactly
 * once per run so that re-visiting `/report` never re-triggers write-back probes against a real
 * EHR. It reuses the same Valkey connection (`#core/storage/valkey`) so a report survives a pod
 * restart and is visible from either replica, with the same in-memory fallback for local dev that
 * `createSessionStore` uses when no Valkey instance is configured.
 *
 * A `ValidationReport` never carries credentials — every `HttpExchange` inside it was already
 * redacted at the moment it was recorded (`#core/http/redact`) — so storing and later serving it
 * verbatim to the browser is safe.
 */

import type { ValidationReport } from '#core/run'
import { createValkeyClientFromEnv, type ValkeyLike } from '#core/storage/valkey'

/** Mirrors `ACTIVE_SESSION_TTL_SECONDS` in `#core/smart/callback`: a report is only useful for as
 * long as the session it was produced from would still be considered active. */
const REPORT_TTL_SECONDS = 60 * 60 * 24

export type ReportStore = {
    get(sessionId: string): Promise<ValidationReport | null>
    set(sessionId: string, report: ValidationReport): Promise<void>
}

const KEY_PREFIX = 'smart-report:'

function keyFor(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`
}

function createInMemoryReportStore(): ReportStore {
    const reports = new Map<string, { report: ValidationReport; expiresAt: number }>()

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
            reports.set(sessionId, { report, expiresAt: Date.now() + REPORT_TTL_SECONDS * 1000 })
            return Promise.resolve()
        },
    }
}

function createValkeyReportStore(client: ValkeyLike): ReportStore {
    return {
        async get(sessionId) {
            const raw = await client.get(keyFor(sessionId))
            if (raw === null) return null

            try {
                return JSON.parse(raw) as ValidationReport
            } catch {
                // Corrupt or truncated record: treat exactly like a miss rather than crashing the caller.
                return null
            }
        },
        async set(sessionId, report) {
            await client.set(keyFor(sessionId), JSON.stringify(report), 'EX', REPORT_TTL_SECONDS)
        },
    }
}

let store: ReportStore | undefined

/** Lazy singleton, mirroring `createSessionStore`: a report is written by the callback request
 * and read by a later `/report` request, so a store rebuilt per call would lose it. */
export function getReportStore(): ReportStore {
    store ??= process.env.VALKEY_URI_SESSIONS
        ? createValkeyReportStore(createValkeyClientFromEnv())
        : createInMemoryReportStore()

    return store
}
