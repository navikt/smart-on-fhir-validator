import * as z from 'zod'

import type { ExchangeRecorder } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'
import { ACTIVE_SESSION_TTL_SECONDS, computeExpiresAt, tokenResponseSchema } from '#core/smart/callback'
import type { ClientAuthentication } from '#core/smart/callback'
import type { ActiveSession, SmartError } from '#core/smart/types'
import { capExchanges, type SessionStore } from '#core/storage/session-store'

const REFRESH_GRANTING_SCOPES = ['offline_access', 'online_access']

export type RefreshDependencies = {
    httpClient: SmartHttpClient
    recorder: ExchangeRecorder
    sessionStore: SessionStore
    /** Resolved for the session's stored `clientId`/auth mode by the caller, as at callback time. */
    clientAuth: ClientAuthentication
    now?: () => Date
}

function grantsRefresh(scope: string): boolean {
    const granted = new Set(scope.split(' ').filter(Boolean))
    return REFRESH_GRANTING_SCOPES.some((required) => granted.has(required))
}

export async function refreshSession(
    sessionId: string,
    deps: RefreshDependencies,
): Promise<ActiveSession | SmartError> {
    const session = await deps.sessionStore.get(sessionId)
    if (!session) return { error: 'session_not_found', detail: 'No session for this session id' }
    if (session.state !== 'active')
        return { error: 'session_not_active', detail: 'Session has not completed its launch' }

    if (!grantsRefresh(session.tokenResponse.scope)) {
        return {
            error: 'refresh_not_permitted',
            detail: 'Neither offline_access nor online_access was granted',
        }
    }

    const refreshToken = session.tokenResponse.refresh_token
    if (!refreshToken) {
        return { error: 'missing_refresh_token', detail: 'Token response did not include a refresh_token' }
    }

    const tokenEndpoint = session.smartConfiguration.token_endpoint
    if (!tokenEndpoint) {
        return {
            error: 'missing_token_endpoint',
            detail: 'SMART configuration did not advertise a token_endpoint',
        }
    }

    const [formFields, headers] = await Promise.all([deps.clientAuth.formFields(), deps.clientAuth.headers()])

    const response = await deps.httpClient.postForm(
        'token',
        tokenEndpoint,
        {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            ...formFields,
        },
        headers,
    )

    if (!response.ok) {
        return {
            error: 'refresh_failed',
            detail: `Token endpoint responded with ${response.status}`,
            exchangeId: response.exchange.id,
        }
    }

    const parsed = tokenResponseSchema.safeParse(response.body)
    if (!parsed.success) {
        return {
            error: 'invalid_token_response',
            detail: z.prettifyError(parsed.error),
            exchangeId: response.exchange.id,
        }
    }

    const now = (deps.now ?? (() => new Date()))()

    const updated: ActiveSession = {
        ...session,
        tokenResponse: {
            ...parsed.data,
            // A refresh response is not required to repeat the refresh token; keep the existing
            // one when omitted, per RFC 6749 section 6.
            refresh_token: parsed.data.refresh_token ?? refreshToken,
        },
        expiresAt: computeExpiresAt(parsed.data.expires_in, now),
        exchanges: capExchanges([...session.exchanges, ...deps.recorder.all()]),
    }

    await deps.sessionStore.set(sessionId, updated, ACTIVE_SESSION_TTL_SECONDS)

    return updated
}
