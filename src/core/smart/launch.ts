import type { HttpExchange } from '#core/http/exchange'
import type { ExchangeRecorder } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'
import type { SessionStore } from '#core/storage/session-store'
import { capExchanges } from '#core/storage/session-store'
import type {
    IssuerConfig,
    PendingSession,
    SmartConfiguration,
    SmartError,
    TokenEndpointAuthMethod,
} from '#core/smart/types'
import { isSmartError } from '#core/smart/types'

/** Long enough to cover a slow login at the EHR, short enough not to linger when abandoned. */
export const PENDING_SESSION_TTL_SECONDS = 600

export type LaunchRequest = {
    /** The FHIR server base URL, from the EHR's `?iss=` launch parameter. */
    iss: string
    /** Opaque launch context identifier, from the EHR's `?launch=` launch parameter. */
    launch: string
}

export type FetchSmartConfiguration = (
    httpClient: SmartHttpClient,
    fhirBaseUrl: string,
) => Promise<{ config: SmartConfiguration; raw: unknown; exchange: HttpExchange } | SmartError>

export type ResolveEndpoint = (value: string | undefined, fhirBaseUrl: string) => string | undefined

export type FindIssuerConfig = (issuer: string) => IssuerConfig | null

export type RegistrationParams = {
    issuer: string
    clientName: string
    redirectUris: string[]
    scope: string
    tokenEndpointAuthMethod: TokenEndpointAuthMethod | 'none'
    jwksUri?: string
}

export type RegisterClient = (
    httpClient: SmartHttpClient,
    registrationEndpoint: string,
    params: RegistrationParams,
) => Promise<IssuerConfig | SmartError>

export type CreatePkcePair = () => { codeVerifier: string; codeChallenge: string; method: string }
export type CreateOauthState = () => string

export type LaunchDependencies = {
    httpClient: SmartHttpClient
    recorder: ExchangeRecorder
    sessionStore: SessionStore
    fetchSmartConfiguration: FetchSmartConfiguration
    resolveEndpoint: ResolveEndpoint
    findIssuerConfig: FindIssuerConfig
    registerClient: RegisterClient
    createPkcePair: CreatePkcePair
    createOauthState: CreateOauthState
    createSessionId: () => string
    /** This app's own `/callback` URL, as registered with the EHR. */
    redirectUri: string
    /** The fixed scope string this app requests of every EHR. */
    scope: string
    /** This app's display name, sent as `client_name` during dynamic client registration. */
    clientName: string
    now?: () => Date
}

export type LaunchResult = {
    sessionId: string
    redirectUrl: string
}

/**
 * Security-critical: an attacker-supplied `iss` must never be usable to redirect this app's
 * credentials, so SMART's https requirement is enforced against every real host. Loopback is the
 * one exception, unreachable from the network, and how the mock EHR and e2e suite launch. The
 * rule deliberately ignores `NODE_ENV` so the e2e suite exercises the deployed behaviour.
 */
export function validateFhirBaseUrl(iss: string): URL | SmartError {
    let url: URL
    try {
        url = new URL(iss)
    } catch {
        return { error: 'invalid_iss', detail: 'iss is not a valid absolute URL' }
    }

    if (url.protocol === 'https:') return url

    if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url

    return { error: 'invalid_iss', detail: 'iss must be an absolute https URL' }
}

/** `http` is tolerated only here, where the request cannot leave the machine. */
function isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export async function handleLaunch(
    request: LaunchRequest,
    deps: LaunchDependencies,
): Promise<LaunchResult | SmartError> {
    const fhirBaseUrlResult = validateFhirBaseUrl(request.iss)
    if (isSmartError(fhirBaseUrlResult)) return fhirBaseUrlResult
    const fhirBaseUrl = fhirBaseUrlResult.toString()

    if (!request.launch) {
        return { error: 'missing_launch', detail: 'launch is required for an EHR launch' }
    }

    const smartConfigResult = await deps.fetchSmartConfiguration(deps.httpClient, fhirBaseUrl)
    if (isSmartError(smartConfigResult)) return smartConfigResult
    const smartConfiguration = smartConfigResult.config

    const authorizationEndpoint = deps.resolveEndpoint(smartConfiguration.authorization_endpoint, fhirBaseUrl)
    if (!authorizationEndpoint) {
        return {
            error: 'missing_authorization_endpoint',
            detail: 'SMART configuration did not advertise an authorization_endpoint',
        }
    }

    const issuer = smartConfiguration.issuer ?? fhirBaseUrl
    const issuerConfigResult = await resolveIssuerConfig(issuer, smartConfiguration, deps)
    if (isSmartError(issuerConfigResult)) return issuerConfigResult
    const issuerConfig = issuerConfigResult

    const pkce = deps.createPkcePair()
    const oauthState = deps.createOauthState()
    const sessionId = deps.createSessionId()
    const now = (deps.now ?? (() => new Date()))()

    const pendingSession: PendingSession = {
        state: 'pending',
        sessionId,
        issuer,
        fhirBaseUrl,
        clientId: issuerConfig.clientId,
        oauthState,
        codeVerifier: pkce.codeVerifier,
        launch: request.launch,
        requestedScope: deps.scope,
        createdAt: now.toISOString(),
        exchanges: capExchanges(deps.recorder.all()),
    }

    await deps.sessionStore.set(sessionId, pendingSession, PENDING_SESSION_TTL_SECONDS)

    const authorizationUrl = new URL(authorizationEndpoint)
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: issuerConfig.clientId,
        redirect_uri: deps.redirectUri,
        scope: deps.scope,
        state: oauthState,
        // REQUIRED by SMART App Launch so the authorization server can check the token is
        // scoped to this FHIR server. Commonly omitted or wrong in vendor implementations.
        aud: fhirBaseUrl,
        launch: request.launch,
        code_challenge: pkce.codeChallenge,
        code_challenge_method: 'S256',
    })
    authorizationUrl.search = params.toString()

    return { sessionId, redirectUrl: authorizationUrl.toString() }
}

/**
 * Static configuration first (an operator can pin a known-good client), then Dynamic Client
 * Registration when advertised, so an unconfigured EHR can still be exercised.
 *
 * Dynamic registration always requests a public client: sessions carry only `clientId`, so no
 * confidential credential could survive from the launch step to the callback step.
 */
async function resolveIssuerConfig(
    issuer: string,
    smartConfiguration: SmartConfiguration,
    deps: LaunchDependencies,
): Promise<IssuerConfig | SmartError> {
    const staticConfig = deps.findIssuerConfig(issuer)
    if (staticConfig) return staticConfig

    if (smartConfiguration.registration_endpoint) {
        return deps.registerClient(deps.httpClient, smartConfiguration.registration_endpoint, {
            issuer,
            clientName: deps.clientName,
            redirectUris: [deps.redirectUri],
            scope: deps.scope,
            tokenEndpointAuthMethod: 'none',
        })
    }

    return {
        error: 'no_client_configuration',
        detail: `No static configuration or dynamic registration available for issuer ${issuer}`,
    }
}
