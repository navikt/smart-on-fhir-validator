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
    issuer: z.string(),
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
    issuer: z.string(),
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

    return {
        get(sessionId) {
            const entry = sessions.get(sessionId)
            if (!entry) return Promise.resolve(null)

            if (entry.expiresAt <= Date.now()) {
                sessions.delete(sessionId)
                return Promise.resolve(null)
            }

            // Round-trip through the same schema real stores use, so tests against this fake
            // catch the same corruption-handling bugs a Valkey-backed store would.
            return Promise.resolve(parseStoredSession(entry.session))
        },
        set(sessionId, session, ttlSeconds) {
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
 * Picks the backend from the environment: Valkey when `VALKEY_URI_SESSIONS` is set, an in-memory
 * store otherwise. Lazy, so importing this module never requires network config.
 *
 * Memoisation is load-bearing: a launch and its callback are separate requests, so a store
 * rebuilt per call would start empty on the callback and lose every pending session. Against
 * Valkey it would also open a new connection per request. See `#core/storage/process-singleton`
 * for why the memo cannot be a plain module-level variable.
 */
export function createSessionStore(): Promise<SessionStore> {
    return processSingleton(SESSION_STORE_KEY, async (): Promise<SessionStore> => {
        if (!process.env.VALKEY_URI_SESSIONS) return createInMemorySessionStore()

        const { createValkeySessionStore, createValkeyClientFromEnv } = await import('./valkey')
        return createValkeySessionStore(createValkeyClientFromEnv())
    })
}

/** Test-only: drops the memoised store so a test can change `VALKEY_URI_SESSIONS`. */
export function resetSessionStoreForTests(): void {
    resetProcessSingleton(SESSION_STORE_KEY)
}
