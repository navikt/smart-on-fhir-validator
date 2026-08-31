import type { HttpExchange } from '#core/http/exchange'
import type { ExchangeRecorder } from '#core/http/exchange'
import type { SmartHttpClient } from '#core/http/smart-http-client'
import { processSingleton, resetProcessSingleton } from '#core/storage/process-singleton'
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

/**
 * Looked up by the TLS-authenticated FHIR base URL (the `iss` launch parameter), never by
 * `smartConfiguration.issuer`. See the comment above `resolveIssuerConfig` below.
 */
export type FindIssuerConfig = (fhirBaseUrl: string) => IssuerConfig | null

export type RegistrationParams = {
    fhirBaseUrl: string
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

    /**
     * Security- and conformance-critical: the credential lookup key is the TLS-authenticated FHIR
     * base URL (`fhirBaseUrl`, already https-validated above by `validateFhirBaseUrl`), never
     * `smartConfiguration.issuer`.
     *
     * `issuer` in `.well-known/smart-configuration` is CONDITIONAL OIDC metadata ("required if
     * the server's capabilities include `sso-openid-connect`; otherwise, omitted", SMART App
     * Launch 2.2 conformance) meant for id_token issuer validation, not a FHIR server identity or
     * a client-registration key. This app requests `openid fhirUser`, so nearly every real vendor
     * publishes it. The spec places no same-origin constraint between a FHIR base URL and its
     * authorization server (all discovery endpoint URLs are merely "absolute URLs"): Oracle
     * Health/Cerner, for one, serves FHIR from `fhir-ehr-code.cerner.com` while its OIDC `issuer`
     * is a different host under `authorization.cerner.com`. Matching static configuration against
     * `smartConfiguration.issuer` therefore (a) breaks a correctly split-origin vendor outright,
     * since nothing in `SMART_ISSUERS` matches an issuer nobody registered, and (b) lets an
     * already-allowlisted but hostile host declare *another* registered vendor's `issuer` string
     * in its own discovery document and be handed that vendor's credential. Keying on
     * `fhirBaseUrl` instead closes both: it is the one value in this whole exchange the EHR cannot
     * spoof, since it is literally the host this app just made an HTTPS request to.
     */
    const issuerConfigResult = await resolveIssuerConfig(fhirBaseUrl, smartConfiguration, deps)
    if (isSmartError(issuerConfigResult)) return issuerConfigResult
    const issuerConfig = issuerConfigResult

    const pkce = deps.createPkcePair()
    const oauthState = deps.createOauthState()
    const sessionId = deps.createSessionId()
    const now = (deps.now ?? (() => new Date()))()

    const pendingSession: PendingSession = {
        state: 'pending',
        sessionId,
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
    fhirBaseUrl: string,
    smartConfiguration: SmartConfiguration,
    deps: LaunchDependencies,
): Promise<IssuerConfig | SmartError> {
    const staticConfig = deps.findIssuerConfig(fhirBaseUrl)
    if (staticConfig) return staticConfig

    if (smartConfiguration.registration_endpoint) {
        return registerClientCached(
            fhirBaseUrl,
            smartConfiguration.registration_endpoint,
            {
                fhirBaseUrl,
                clientName: deps.clientName,
                redirectUris: [deps.redirectUri],
                scope: deps.scope,
                tokenEndpointAuthMethod: 'none',
            },
            deps,
        )
    }

    return {
        error: 'no_client_configuration',
        detail: `No static configuration or dynamic registration available for FHIR base URL ${fhirBaseUrl}`,
    }
}

const DYNAMIC_REGISTRATION_CACHE_KEY = 'smart-launch:dynamic-registration-cache'

/**
 * Hard cap on the number of distinct FHIR base URLs held in the dynamic registration cache at
 * once, to bound its worst-case footprint against the pod's 1024Mi memory limit.
 *
 * Like the session store this guards against the same threat (see `MAX_STORED_SESSIONS` in
 * `#core/storage/session-store`), `/launch` is internet-facing, unauthenticated and
 * unrate-limited, and every distinct https `iss` an attacker points here that also serves a
 * `.well-known/smart-configuration` with a `registration_endpoint` grows this map by one entry.
 * Unlike the session store, this cache has no TTL (see `dynamicRegistrationCache` below for why
 * one is deliberately not used), so entries would otherwise persist for the life of the process
 * rather than ageing out on their own.
 *
 * Each entry is small: a cache-key URL string plus a resolved `IssuerConfig` (a couple of short
 * string fields and a boolean). Generously accounting for `Map`/`Promise`/V8 string overhead at
 * ~2KB/entry, a fully-capped cache costs on the order of 1MB -- negligible against the pod limit,
 * and far below what the session store already reserves for a comparable purpose. The real
 * legitimate demand here is one entry per distinct EHR this validator is actually exercised
 * against; for a manually-triggered conformance tool that is realistically single digits to low
 * hundreds, not the unbounded cardinality an attacker can mint by varying subdomains. 500 sits
 * comfortably above realistic legitimate use while still bounding the worst case: on the rare
 * occasion an entry is evicted to make room (see `evictOneRegistration` below), the next launch
 * for that FHIR base URL simply performs a new RFC 7591 registration -- a normal, already-tested
 * code path (see "does not permanently cache a failed registration" below), not a failure.
 */
export const MAX_DYNAMIC_REGISTRATIONS = 500

type DynamicRegistrationCacheEntry = {
    promise: Promise<IssuerConfig | SmartError>
    /** False while the registration call is still in flight; set once it resolves successfully. */
    settled: boolean
}

/**
 * Per-process memo of dynamic client registrations, keyed by FHIR base URL.
 *
 * `/launch` is unauthenticated and carries no rate limit, and with `SMART_ISSUERS` currently `[]`
 * every launch against an unconfigured EHR falls through to here. RFC 7591 registration
 * *provisions* a new client at the vendor's authorization server; it is not an idempotent lookup,
 * so calling it on every request would create an unbounded number of client registrations at the
 * vendor, all from Nav's IP, for what is really one integration. The client ID from the first
 * successful registration is meant to be reused for the life of that integration, so it is cached
 * here and handed back to every later launch for the same FHIR base URL.
 *
 * `processSingleton` (rather than a module-level `let`) is required for the same reason it is used
 * for the session and report stores: Route Handlers compile into separate module graphs, so only
 * `globalThis` is guaranteed shared between them. Per-process is an acceptable scope for the same
 * reason it is for those stores: pods are pinned to one replica (see `.nais/nais-dev.yaml`), so
 * nothing here needs to be shared across pods, and a pod restart simply re-registers on the next
 * launch, which is rare and harmless next to the unbounded-registration risk this closes.
 *
 * Deliberately no TTL: a registered client ID is handed to the browser and to the EHR's own
 * authorization flow, and may still be in active use by a session created long before this entry
 * would expire (`ACTIVE_SESSION_TTL_SECONDS` in `#core/smart/callback` is 24h, itself
 * renewable by re-launching). Expiring an entry out from under a still-valid client ID would not
 * invalidate anything at the vendor, but it would make a later launch silently mint a *second*
 * client registration for the same integration -- exactly the duplicate-registration problem this
 * cache exists to prevent. `MAX_DYNAMIC_REGISTRATIONS` bounds memory instead; see there for why an
 * eviction is harmless by comparison.
 */
function dynamicRegistrationCache(): Map<string, DynamicRegistrationCacheEntry> {
    return processSingleton(
        DYNAMIC_REGISTRATION_CACHE_KEY,
        () => new Map<string, DynamicRegistrationCacheEntry>(),
    )
}

/**
 * Frees up room for one more entry when the cache is at `MAX_DYNAMIC_REGISTRATIONS`.
 *
 * There is no TTL here (see `dynamicRegistrationCache` above for why), so "oldest" is by insertion
 * order, which a `Map` preserves and which entries are never re-inserted on lookup, so this is
 * oldest-write, not least-recently-used. A settled (already-registered) entry is safe to evict --
 * the FHIR base URL it names simply re-registers on its next launch. An entry whose registration
 * is still in flight is preferred to keep: evicting it wouldn't break the concurrent callers
 * already holding its promise, but it would let a third, later launch for the same FHIR base URL
 * start a redundant duplicate registration instead of joining the one already running. So: evict
 * the oldest settled entry first, and only fall back to the oldest entry overall (in-flight or
 * not) if every entry currently in the cache is still in flight.
 */
function evictOneRegistration(cache: Map<string, DynamicRegistrationCacheEntry>): void {
    for (const [cacheKey, entry] of cache) {
        if (entry.settled) {
            cache.delete(cacheKey)
            return
        }
    }

    const oldestCacheKey = cache.keys().next().value
    if (oldestCacheKey !== undefined) cache.delete(oldestCacheKey)
}

/** Test-only: drops the memoised dynamic registrations so a test can start from a clean cache. */
export function resetDynamicRegistrationCacheForTests(): void {
    resetProcessSingleton(DYNAMIC_REGISTRATION_CACHE_KEY)
}

/**
 * Mirrors the static-configuration lookup key in `#core/config/issuers`: a trailing slash on the
 * FHIR base URL must not register the same EHR twice under two different cache entries.
 */
function normaliseFhirBaseUrlForCache(fhirBaseUrl: string): string {
    try {
        const url = new URL(fhirBaseUrl)
        return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
    } catch {
        return fhirBaseUrl
    }
}

/**
 * Registers a client for `fhirBaseUrl`, coalescing concurrent callers and memoising the result of
 * the first successful attempt process-wide. See `dynamicRegistrationCache` above for why.
 *
 * The cache stores the in-flight *promise*, not just an eventual value: two launches racing for
 * the same, not-yet-registered FHIR base URL (two browser tabs, a user double-clicking, or an EHR
 * retrying a slow request) must coalesce into a single registration call rather than each firing
 * its own. Because this function performs no `await` before populating the cache, that check-then-
 * set is atomic with respect to the event loop: nothing else can run between the `get` miss and the
 * `set` below, so it needs no separate lock.
 *
 * A failure is deliberately *not* kept: whether `registerClient` resolves to a `SmartError` or its
 * promise rejects outright, the entry is evicted so the next launch retries from scratch. A
 * vendor's registration endpoint being briefly unreachable, or misconfigured only at the moment of
 * the first attempt, must not permanently wedge every later launch against that FHIR base URL.
 *
 * Eviction is only ever attempted here, on a cache miss: overwriting an existing key (the `if
 * (cached) return` above already handles that) doesn't grow the map, so it can never push the
 * cache over `MAX_DYNAMIC_REGISTRATIONS`. Mirrors `evictOne`'s caller in
 * `createInMemorySessionStore` in `#core/storage/session-store`.
 */
function registerClientCached(
    fhirBaseUrl: string,
    registrationEndpoint: string,
    params: RegistrationParams,
    deps: Pick<LaunchDependencies, 'httpClient' | 'registerClient'>,
): Promise<IssuerConfig | SmartError> {
    const cache = dynamicRegistrationCache()
    const cacheKey = normaliseFhirBaseUrlForCache(fhirBaseUrl)

    const cached = cache.get(cacheKey)
    if (cached) return cached.promise

    if (cache.size >= MAX_DYNAMIC_REGISTRATIONS) evictOneRegistration(cache)

    const entry: DynamicRegistrationCacheEntry = {
        promise: deps.registerClient(deps.httpClient, registrationEndpoint, params).then((result) => {
            if (isSmartError(result)) {
                cache.delete(cacheKey)
            } else {
                // Only now, not while the call is still in flight, is this entry safe to evict
                // without risking a duplicate registration for a concurrent caller. See
                // `evictOneRegistration` above.
                entry.settled = true
            }
            return result
        }),
        settled: false,
    }
    // Evict on rejection too, otherwise a later launch would be permanently stuck with a promise
    // that already rejected. Attached separately from the `.then` above so this cleanup runs
    // without altering what the cached promise itself resolves or rejects with for callers.
    entry.promise.catch(() => cache.delete(cacheKey))

    cache.set(cacheKey, entry)
    return entry.promise
}
