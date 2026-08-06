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

/**
 * The launch step persists a `PendingSession` for ten minutes: long enough to cover a slow login
 * at the EHR's authorization server, short enough that an abandoned launch does not linger.
 */
export const PENDING_SESSION_TTL_SECONDS = 600

export type LaunchRequest = {
    /** The FHIR server base URL, from the EHR's `?iss=` launch parameter. */
    iss: string
    /** Opaque launch context identifier, from the EHR's `?launch=` launch parameter. */
    launch: string
}

/**
 * Collaborator signatures mirror `#core/smart/discovery`, `#core/smart/pkce`,
 * `#core/smart/registration` and `#core/config/issuers`, injected rather than imported directly
 * so this module can be built, and tested with fakes, independently of those modules.
 */
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
    /** Used only by a client with no static config and no dynamic registration support. */
    defaultPublicClientId?: string
    now?: () => Date
}

export type LaunchResult = {
    sessionId: string
    redirectUrl: string
}

/**
 * Security-critical: an attacker-supplied `iss` must never be usable to redirect this app's
 * credentials. SMART requires `https`, and this app enforces it against every real host.
 *
 * The single exception is a loopback address, which is not reachable from the network and so
 * cannot be used to exfiltrate anything — it is how the built-in mock EHR and the e2e suite are
 * launched. The rule deliberately does not depend on `NODE_ENV`: a check that behaves one way in
 * development and another in production is only ever exercised in one of them, and the e2e suite
 * runs against a production build precisely so it tests what is deployed.
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
        // REQUIRED by SMART App Launch: the FHIR server's base URL, so the authorization server
        // can validate that this client requested a token scoped to that specific server. A very
        // common vendor bug is to omit it or to send the wrong value.
        aud: fhirBaseUrl,
        launch: request.launch,
        code_challenge: pkce.codeChallenge,
        code_challenge_method: 'S256',
    })
    authorizationUrl.search = params.toString()

    return { sessionId, redirectUrl: authorizationUrl.toString() }
}

/**
 * Static configuration takes priority (an operator can pin a known-good client), then Dynamic
 * Client Registration when the EHR advertises it, then a single shared public client as a last
 * resort so an otherwise-unconfigured, registration-less EHR can still be exercised.
 *
 * Dynamic registration is always requested as a public client (`tokenEndpointAuthMethod: 'none'`):
 * `PendingSession`/`ActiveSession` only carry `clientId`, not a full `ClientAuthMode`, so nothing
 * a confidential DCR client is granted (a secret, a key reference) could survive from the launch
 * step to the callback step. Requesting 'none' keeps that fixed data shape sound — the callback
 * step re-derives `{ type: 'public' }` for any issuer it does not find in static configuration.
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

    if (deps.defaultPublicClientId) {
        return {
            issuer,
            clientId: deps.defaultPublicClientId,
            auth: { type: 'public' },
            dynamicallyRegistered: false,
        }
    }

    return {
        error: 'no_client_configuration',
        detail: `No static configuration, dynamic registration or default public client available for issuer ${issuer}`,
    }
}
