import { createExchangeRecorder, type HttpExchange } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { FhirClient } from '#core/fhir/client'
import { resolveCallbackIssuerConfig, type SelectClientAuthentication } from '#core/smart/callback'
import type { FindIssuerConfig } from '#core/smart/launch'
import { refreshSession } from '#core/smart/refresh'
import { isSmartError, type ActiveSession } from '#core/smart/types'
import type { SessionStore } from '#core/storage/session-store'

import { MAX_DEBUG_BODY_BYTES, buildDebugUrl, validateDebugRequest } from './request'

export const DEBUG_TIMEOUT_MS = 15_000
export const TOKEN_EXPIRY_MARGIN_MS = 30_000

export const SESSION_EXPIRED_DETAIL = 'Your access token has expired. Launch again from your EHR.'

export type DebugErrorCode = 'no_session' | 'invalid_request' | 'session_expired'

export type DebugError = { error: DebugErrorCode; detail: string }

export type DebugResult = { exchange: HttpExchange; bodyTruncated: boolean }

export type DebugProxyDependencies = {
    sessionStore: SessionStore
    findIssuerConfig: FindIssuerConfig
    selectClientAuthentication: SelectClientAuthentication
    fetchImpl?: typeof fetch
    now?: () => Date
}

export function isDebugError(value: DebugResult | DebugError): value is DebugError {
    return 'error' in value
}

export const DEBUG_ERROR_STATUS: Record<DebugErrorCode, number> = {
    no_session: 401,
    session_expired: 401,
    invalid_request: 400,
}

function isExpiring(session: ActiveSession, now: Date): boolean {
    return !(now.getTime() < Date.parse(session.expiresAt) - TOKEN_EXPIRY_MARGIN_MS)
}

async function refreshIfNeeded(
    session: ActiveSession,
    deps: DebugProxyDependencies,
    now: Date,
): Promise<ActiveSession | DebugError> {
    if (!isExpiring(session, now)) return session

    if (!session.tokenResponse.refresh_token) {
        return { error: 'session_expired', detail: SESSION_EXPIRED_DETAIL }
    }

    const issuerConfig = resolveCallbackIssuerConfig(
        session.fhirBaseUrl,
        session.clientId,
        deps.findIssuerConfig,
    )
    const recorder = createExchangeRecorder()
    const refreshed = await refreshSession(session.sessionId, {
        httpClient: new SmartHttpClient({
            recorder,
            fetchImpl: deps.fetchImpl,
            timeoutMs: DEBUG_TIMEOUT_MS,
        }),
        recorder,
        sessionStore: deps.sessionStore,
        clientAuth: deps.selectClientAuthentication(
            issuerConfig.clientId,
            issuerConfig.auth,
            session.smartConfiguration.token_endpoint ?? '',
        ),
        now: () => now,
    })

    if (isSmartError(refreshed)) {
        return {
            error: 'session_expired',
            detail: `Your access token has expired and could not be refreshed (${refreshed.error}). Launch again from your EHR.`,
        }
    }

    return refreshed
}

export async function executeDebugRequest(
    sessionId: string,
    input: unknown,
    deps: DebugProxyDependencies,
): Promise<DebugResult | DebugError> {
    const session = await deps.sessionStore.get(sessionId)
    if (!session || session.state !== 'active') {
        return { error: 'no_session', detail: 'No active session. Launch from your EHR first.' }
    }

    const request = validateDebugRequest(input)
    if (isSmartError(request)) return { error: 'invalid_request', detail: request.detail ?? request.error }

    const url = buildDebugUrl(session.fhirBaseUrl, request)
    if (isSmartError(url)) return { error: 'invalid_request', detail: url.detail ?? url.error }

    const now = (deps.now ?? (() => new Date()))()
    const active = request.authentication === 'session' ? await refreshIfNeeded(session, deps, now) : session
    if ('error' in active) return active

    const client = new FhirClient({
        http: new SmartHttpClient({
            recorder: createExchangeRecorder(),
            fetchImpl: deps.fetchImpl,
            timeoutMs: DEBUG_TIMEOUT_MS,
            maxResponseBytes: MAX_DEBUG_BODY_BYTES,
        }),
        baseUrl: active.fhirBaseUrl,
        accessToken: active.tokenResponse.access_token,
    })

    const response = await client.request({
        method: request.method,
        url: url.toString(),
        body: request.body,
        contentType: request.contentType,
        accessToken:
            request.authentication === 'session'
                ? undefined
                : request.authentication === 'none'
                  ? null
                  : request.customToken,
    })

    return { exchange: response.exchange, bodyTruncated: response.bodyTruncated }
}
