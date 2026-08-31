import * as z from 'zod'

import type { HttpExchange } from '#core/http/exchange'
import type { SmartSession } from '#core/smart/types'
import { processSingleton, resetProcessSingleton } from '#core/storage/process-singleton'

const SESSION_STORE_KEY = 'session-store'

/** Storage for `SmartSession`s, keyed by the opaque session id carried in the session cookie. */
export interface SessionStore {
    get(sessionId: string): Promise<SmartSession | null>
    set(sessionId: string, session: SmartSession, ttlSeconds: number): Promise<void>
    delete(sessionId: string): Promise<void>
}

/**
 * Caps the stored evidence trail, which grows with every discovery, registration, authorization
 * and token call. Only the most recent exchanges are kept.
 */
export const MAX_STORED_EXCHANGES = 200

/**
 * Hard cap on the number of sessions held at once, to bound the store's worst-case footprint
 * against the pod's 1024Mi memory limit.
 *
 * `/launch` is internet-facing with no authentication and no rate limiting, and it writes a
 * pending session on every successful discovery, so the number of live entries is attacker-
 * controlled. Each entry can carry up to `MAX_STORED_EXCHANGES` full HTTP request/response
 * bodies (not just headers), and a session lives for up to `ACTIVE_SESSION_TTL_SECONDS` (24h)
 * once active, so entries cannot be relied on to age out quickly on their own.
 *
 * Assuming an average redacted exchange (headers plus a JSON body) of roughly 10KB -- generous
 * for the small discovery/registration/token/jwks payloads that make up most of a run, while
 * acknowledging that a handful of larger capability-statement or FHIR bundle exchanges can push
 * a real session higher -- a fully-capped session costs about
 * `MAX_STORED_EXCHANGES * 10KB` ~= 2MB. Reserving roughly 10% of the 1024Mi limit
 * (~100MB) for this store, the most exposed of the two because it's reachable unauthenticated,
 * yields `100MB / 2MB` ~= 50 sessions. The remaining ~90% stays available for the Next.js
 * runtime, concurrent request handling and GC headroom -- the exact resource an unbounded store
 * was starving, causing the single replica to be OOMKilled mid-flight for every in-flight user.
 */
export const MAX_STORED_SESSIONS = 50

export function capExchanges(exchanges: readonly HttpExchange[]): HttpExchange[] {
    if (exchanges.length <= MAX_STORED_EXCHANGES) return [...exchanges]

    return exchanges.slice(exchanges.length - MAX_STORED_EXCHANGES)
}

const exchangePhaseSchema = z.enum([
    'discovery',
    'registration',
    'authorization',
    'token',
    'jwks',
    'capability',
    'fhir-read',
    'fhir-write',
])

const httpExchangeSchema = z.object({
    id: z.string(),
    phase: exchangePhaseSchema,
    request: z.object({
        method: z.string(),
        url: z.string(),
        headers: z.record(z.string(), z.string()),
        body: z.string().optional(),
    }),
    response: z
        .object({
            status: z.number(),
            statusText: z.string(),
            headers: z.record(z.string(), z.string()),
            body: z.unknown(),
        })
        .nullable(),
    error: z.string().nullable(),
    startedAt: z.string(),
    durationMs: z.number(),
})

const tokenResponseSchema = z.looseObject({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number().optional(),
    scope: z.string(),
    id_token: z.string().optional(),
    refresh_token: z.string().optional(),
    patient: z.string().optional(),
    encounter: z.string().optional(),
    fhirUser: z.string().optional(),
    need_patient_banner: z.boolean().optional(),
    smart_style_url: z.string().optional(),
    intent: z.string().optional(),
    tenant: z.string().optional(),
})

const smartConfigurationSchema = z.object({
    issuer: z.string().optional(),
    jwks_uri: z.string().optional(),
    authorization_endpoint: z.string().optional(),
    grant_types_supported: z.array(z.string()).optional(),
    token_endpoint: z.string().optional(),
    token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
    registration_endpoint: z.string().optional(),
    associated_endpoints: z
        .array(z.object({ url: z.string(), capabilities: z.array(z.string()) }))
        .optional(),
    user_access_brand_bundle: z.string().optional(),
    user_access_brand_identifier: z.string().optional(),
    scopes_supported: z.array(z.string()).optional(),
    response_types_supported: z.array(z.string()).optional(),
    management_endpoint: z.string().optional(),
    introspection_endpoint: z.string().optional(),
    revocation_endpoint: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    code_challenge_methods_supported: z.array(z.string()).optional(),
})

const pendingSessionSchema = z.object({
    state: z.literal('pending'),
    sessionId: z.string(),
    fhirBaseUrl: z.string(),
    clientId: z.string(),
    oauthState: z.string(),
    codeVerifier: z.string(),
    launch: z.string(),
    requestedScope: z.string(),
    createdAt: z.string(),
    exchanges: z.array(httpExchangeSchema),
})

const activeSessionSchema = z.object({
    state: z.literal('active'),
    sessionId: z.string(),
    fhirBaseUrl: z.string(),
    clientId: z.string(),
    requestedScope: z.string(),
    tokenResponse: tokenResponseSchema,
    expiresAt: z.string(),
    idTokenClaims: z.record(z.string(), z.unknown()).nullable(),
    smartConfiguration: smartConfigurationSchema,
    createdAt: z.string(),
    exchanges: z.array(httpExchangeSchema),
})

/**
 * Wire format for stored sessions. Parsed on every read: a stale or corrupted record is treated
 * as a cache miss, which merely sends the user through `/launch` again.
 */
export const smartSessionSchema = z.discriminatedUnion('state', [pendingSessionSchema, activeSessionSchema])

export function parseStoredSession(value: unknown): SmartSession | null {
    const result = smartSessionSchema.safeParse(value)
    return result.success ? result.data : null
}

export function createInMemorySessionStore(): SessionStore {
    const sessions = new Map<string, { session: SmartSession; expiresAt: number }>()

    /**
     * Frees up room for one more entry when the store is full.
     *
     * An already-expired entry is worthless, so reclaiming it costs nothing; evicting a live
     * session kicks a real vendor mid-flow. So: sweep for the first expired entry and drop that,
     * and only fall back to the oldest live entry (the first key in insertion order -- a `Map`
     * preserves insertion order, and entries are never re-inserted on `get`, so this is oldest-
     * write, not least-recently-used) if nothing has expired yet.
     */
    function evictOne(): void {
        const now = Date.now()
        for (const [sessionId, entry] of sessions) {
            if (entry.expiresAt <= now) {
                sessions.delete(sessionId)
                return
            }
        }

        const oldestSessionId = sessions.keys().next().value
        if (oldestSessionId !== undefined) sessions.delete(oldestSessionId)
    }

    return {
        get(sessionId) {
            const entry = sessions.get(sessionId)
            if (!entry) return Promise.resolve(null)

            if (entry.expiresAt <= Date.now()) {
                sessions.delete(sessionId)
                return Promise.resolve(null)
            }

            // Round-trip through the same schema used on write, so a corrupted or stale record is
            // treated as a cache miss rather than crashing the caller.
            return Promise.resolve(parseStoredSession(entry.session))
        },
        set(sessionId, session, ttlSeconds) {
            // Overwriting an existing key doesn't grow the map, so it never needs to evict.
            if (!sessions.has(sessionId) && sessions.size >= MAX_STORED_SESSIONS) {
                evictOne()
            }

            sessions.set(sessionId, {
                session: { ...session, exchanges: capExchanges(session.exchanges) },
                expiresAt: Date.now() + ttlSeconds * 1000,
            })
            return Promise.resolve()
        },
        delete(sessionId) {
            sessions.delete(sessionId)
            return Promise.resolve()
        },
    }
}

/**
 * In-memory session store, memoised process-wide.
 *
 * Memoisation is load-bearing: a launch and its callback are separate requests, so a store
 * rebuilt per call would start empty on the callback and lose every pending session. See
 * `#core/storage/process-singleton` for why the memo cannot be a plain module-level variable.
 *
 * Sessions do not survive a pod restart and are not shared across pods; a launch and its callback
 * must land on the same pod within the session's TTL.
 */
export function createSessionStore(): Promise<SessionStore> {
    return Promise.resolve(processSingleton(SESSION_STORE_KEY, createInMemorySessionStore))
}

/** Test-only: drops the memoised store so a test can start from a clean one. */
export function resetSessionStoreForTests(): void {
    resetProcessSingleton(SESSION_STORE_KEY)
}
