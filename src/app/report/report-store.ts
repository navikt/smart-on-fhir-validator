/**
 * Storage for a completed `ValidationReport`, keyed by the opaque session id carried in the
 * session cookie.
 *
 * Deliberately a separate store from `#core/storage/session-store`: a report is a derived
 * artefact, produced exactly once per run so that re-visiting `/report` never re-triggers
 * write-back probes against a real EHR.
 *
 * A `ValidationReport` never carries credentials — every `HttpExchange` inside it was redacted at
 * recording time (`#core/http/redact`) — so serving it verbatim to the browser is safe.
 */

import type { ValidationReport } from '#core/run'
import { processSingleton } from '#core/storage/process-singleton'
import { createValkeyClientFromEnv, type ValkeyLike } from '#core/storage/valkey'

const REPORT_STORE_KEY = 'report-store'

/** Mirrors `ACTIVE_SESSION_TTL_SECONDS` in `#core/smart/callback`: a report is only useful for as
 * long as the session it was produced from would still be active. */
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
                // Corrupt or truncated record: treat as a miss rather than crashing the caller.
                return null
            }
        },
        async set(sessionId, report) {
            await client.set(keyFor(sessionId), JSON.stringify(report), 'EX', REPORT_TTL_SECONDS)
        },
    }
}

/** Must be anchored on `globalThis` — see `#core/storage/process-singleton`. */
export function getReportStore(): ReportStore {
    return processSingleton(REPORT_STORE_KEY, (): ReportStore =>
        process.env.VALKEY_URI_SESSIONS
            ? createValkeyReportStore(createValkeyClientFromEnv())
            : createInMemoryReportStore(),
    )
}
