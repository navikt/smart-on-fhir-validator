import { timingSafeEqual } from 'node:crypto'

import * as z from 'zod'

import type { ExchangeRecorder } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'
import { decodeIdTokenClaims } from '#core/smart/id-token'
import type { FetchSmartConfiguration, FindIssuerConfig } from '#core/smart/launch'
import type { ActiveSession, ClientAuthMode, IssuerConfig, SmartError } from '#core/smart/types'
import { isSmartError } from '#core/smart/types'
import { capExchanges, type SessionStore } from '#core/storage/session-store'

/** Long enough for a validation run that pauses and resumes, short enough not to linger. */
export const ACTIVE_SESSION_TTL_SECONDS = 60 * 60 * 24

/** A non-conformant server may omit `expires_in` entirely; assume the shortest sane lifetime. */
const DEFAULT_EXPIRES_IN_SECONDS = 300

export type CallbackRequest = {
    sessionId: string
    code?: string
    state?: string
    /** https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2.1 */
    error?: string
    error_description?: string
}

export type ClientAuthentication = {
    formFields: () => Promise<Record<string, string>>
    headers: () => Promise<Record<string, string>>
}

export type SelectClientAuthentication = (
    clientId: string,
    mode: ClientAuthMode,
    tokenEndpoint: string,
) => ClientAuthentication

export type CallbackDependencies = {
    httpClient: SmartHttpClient
    recorder: ExchangeRecorder
    sessionStore: SessionStore
    fetchSmartConfiguration: FetchSmartConfiguration
    findIssuerConfig: FindIssuerConfig
    selectClientAuthentication: SelectClientAuthentication
    /** This app's own `/callback` URL — must match what was sent to the authorization endpoint. */
    redirectUri: string
    now?: () => Date
}

/**
 * Only the three fields SMART actually requires are enforced; everything else is optional or
 * passed through, so a non-conformant token response is still persisted and reported on rather
 * than rejected. Only a non-2xx status or an unparseable body is a hard failure.
 */
export const tokenResponseSchema = z.looseObject({
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

export function computeExpiresAt(expiresIn: number | undefined, now: Date): string {
    const seconds = expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS
    return new Date(now.getTime() + seconds * 1000).toISOString()
}

/** Constant-time compare so a mismatching `state` cannot be distinguished bit-by-bit by timing. */
function statesMatch(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected)
    const actualBuffer = Buffer.from(actual)
    if (expectedBuffer.length !== actualBuffer.length) return false

    return timingSafeEqual(expectedBuffer, actualBuffer)
}

/**
 * Sessions only carry `clientId`, not a full `ClientAuthMode`, so a dynamically-registered
 * client's auth mode cannot travel from launch to callback. `launch.ts` always registers as a
 * public client, so falling back to `{ type: 'public' }` here is exactly correct.
 */
function resolveCallbackIssuerConfig(
    issuer: string,
    clientId: string,
    findIssuerConfig: FindIssuerConfig,
): IssuerConfig {
    return (
        findIssuerConfig(issuer) ?? {
            issuer,
            clientId,
            auth: { type: 'public' },
            dynamicallyRegistered: true,
        }
    )
}

export async function handleCallback(
    request: CallbackRequest,
    deps: CallbackDependencies,
): Promise<ActiveSession | SmartError> {
    if (request.error) {
        return { error: request.error, detail: request.error_description }
    }

    if (!request.code || !request.state) {
        return { error: 'invalid_callback', detail: 'code and state query parameters are required' }
    }

    const pending = await deps.sessionStore.get(request.sessionId)
    if (!pending) return { error: 'session_not_found', detail: 'No pending session for this session id' }
    if (pending.state !== 'pending')
        return { error: 'session_not_pending', detail: 'Session has already completed its launch' }

    // CSRF defense: without this an attacker could complete their own authorization_code
    // exchange inside the victim's session.
    if (!statesMatch(pending.oauthState, request.state)) {
        return { error: 'state_mismatch', detail: 'state parameter does not match the pending session' }
    }

    const issuerConfig = resolveCallbackIssuerConfig(pending.issuer, pending.clientId, deps.findIssuerConfig)

    const smartConfigResult = await deps.fetchSmartConfiguration(deps.httpClient, pending.fhirBaseUrl)
    if (isSmartError(smartConfigResult)) return smartConfigResult
    const smartConfiguration = smartConfigResult.config

    if (!smartConfiguration.token_endpoint) {
        return {
            error: 'missing_token_endpoint',
            detail: 'SMART configuration did not advertise a token_endpoint',
        }
    }

    const clientAuth = deps.selectClientAuthentication(
        issuerConfig.clientId,
        issuerConfig.auth,
        smartConfiguration.token_endpoint,
    )
    const [formFields, headers] = await Promise.all([clientAuth.formFields(), clientAuth.headers()])

    const tokenResponse = await deps.httpClient.postForm(
        'token',
        smartConfiguration.token_endpoint,
        {
            grant_type: 'authorization_code',
            code: request.code,
            redirect_uri: deps.redirectUri,
            code_verifier: pending.codeVerifier,
            ...formFields,
        },
        headers,
    )

    if (!tokenResponse.ok) {
        return {
            error: 'token_exchange_failed',
            detail: `Token endpoint responded with ${tokenResponse.status}`,
            exchangeId: tokenResponse.exchange.id,
        }
    }

    const parsedTokenResponse = tokenResponseSchema.safeParse(tokenResponse.body)
    if (!parsedTokenResponse.success) {
        return {
            error: 'invalid_token_response',
            detail: z.prettifyError(parsedTokenResponse.error),
            exchangeId: tokenResponse.exchange.id,
        }
    }

    const now = (deps.now ?? (() => new Date()))()

    const activeSession: ActiveSession = {
        state: 'active',
        sessionId: request.sessionId,
        issuer: pending.issuer,
        fhirBaseUrl: pending.fhirBaseUrl,
        clientId: issuerConfig.clientId,
        requestedScope: pending.requestedScope,
        tokenResponse: parsedTokenResponse.data,
        expiresAt: computeExpiresAt(parsedTokenResponse.data.expires_in, now),
        idTokenClaims: parsedTokenResponse.data.id_token
            ? decodeIdTokenClaims(parsedTokenResponse.data.id_token)
            : null,
        smartConfiguration,
        createdAt: pending.createdAt,
        exchanges: capExchanges([...pending.exchanges, ...deps.recorder.all()]),
    }

    await deps.sessionStore.set(request.sessionId, activeSession, ACTIVE_SESSION_TTL_SECONDS)

    return activeSession
}
