import Redis from 'iovalkey'

import { logger } from '#core/logger'

import { capExchanges, parseStoredSession, type SessionStore } from './session-store'

/**
 * Nais provisions a Valkey instance with three env vars per named instance: `VALKEY_URI_<name>`
 * (a `rediss://` or `redis://` connection string, host and port already resolved) plus
 * `VALKEY_USERNAME_<name>` and `VALKEY_PASSWORD_<name>` for ACL auth. This app's instance is
 * named `sessions`. See https://doc.nais.io/persistence/valkey/.
 */
export type ValkeyEnv = {
    uri: string
    username?: string
    password?: string
}

export function readValkeyEnv(): ValkeyEnv | null {
    const uri = process.env.VALKEY_URI_SESSIONS
    if (!uri) return null

    return {
        uri,
        username: process.env.VALKEY_USERNAME_SESSIONS,
        password: process.env.VALKEY_PASSWORD_SESSIONS,
    }
}

export function createValkeyClientFromEnv(): Redis {
    const env = readValkeyEnv()
    if (!env) throw new Error('VALKEY_URI_SESSIONS is not set')

    const client = new Redis(env.uri, {
        username: env.username,
        password: env.password,
        lazyConnect: true,
    })

    client.on('error', (err: Error) => logger.error({ err: err.message }, 'valkey connection error'))

    return client
}

/**
 * The subset of the `iovalkey`/`Redis` API this store needs. Kept minimal and structural so
 * tests can inject a fake without depending on a real client or a network connection.
 */
export interface ValkeyLike {
    get(key: string): Promise<string | null>
    set(key: string, value: string, secondsToken: 'EX', seconds: number): Promise<'OK' | null>
    del(key: string): Promise<number>
}

const KEY_PREFIX = 'smart-session:'

function keyFor(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`
}

export function createValkeySessionStore(client: ValkeyLike): SessionStore {
    return {
        async get(sessionId) {
            const raw = await client.get(keyFor(sessionId))
            if (raw === null) return null

            let parsed: unknown
            try {
                parsed = JSON.parse(raw)
            } catch {
                // Corrupt or truncated record: treat exactly like a miss rather than crashing the caller.
                return null
            }

            return parseStoredSession(parsed)
        },
        async set(sessionId, session, ttlSeconds) {
            const capped = { ...session, exchanges: capExchanges(session.exchanges) }
            await client.set(keyFor(sessionId), JSON.stringify(capped), 'EX', ttlSeconds)
        },
        async delete(sessionId) {
            await client.del(keyFor(sessionId))
        },
    }
}
