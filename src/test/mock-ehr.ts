/**
 * Shared integration-test harness: drives a complete SMART App Launch (discovery, authorize,
 * PKCE-protected code exchange, token) through this app's own `#core/smart` modules against the
 * in-repo mock EHR (`#mocks/server`), entirely in-process. No network, no port.
 *
 * Every integration test therefore exercises the real client code path rather than
 * re-implementing the OAuth dance by hand the way `src/mocks/server.test.ts` does to test the
 * mock itself.
 */

import { randomUUID } from 'node:crypto'

import type { Hono } from 'hono'
import { exportJWK, generateKeyPair, type JSONWebKeySet } from 'jose'

import { FhirClient } from '#core/fhir/client'
import { createExchangeRecorder, type ExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'
import { handleCallback } from '#core/smart/callback'
import { selectClientAuthentication } from '#core/smart/client-auth'
import { fetchSmartConfiguration, resolveEndpoint } from '#core/smart/discovery'
import { handleLaunch } from '#core/smart/launch'
import { createOauthState, createPkcePair } from '#core/smart/pkce'
import { registerClient } from '#core/smart/registration'
import type {
    ActiveSession,
    ClientAuthMode,
    IssuerConfig,
    LaunchContext,
    SmartError,
} from '#core/smart/types'
import { isSmartError } from '#core/smart/types'
import { createInMemorySessionStore, type SessionStore } from '#core/storage/session-store'
import type { Defect, MockClientAuthMethod, MockEhrConfig } from '#mocks/server'
import { createMockEhr } from '#mocks/server'
import { buildLaunchContext } from '#validation/smart/launch-context'

export const MOCK_EHR_BASE_URL = 'https://mock-ehr.example.com/fhir'
export const APP_REDIRECT_URI = 'https://validator.nav.no/callback'
export const APP_CLIENT_NAME = 'Nav SMART on FHIR Validator (integration test)'

/**
 * Covers every phase this suite cares about: identity (`openid`/`fhirUser`), both launch-context
 * forms (`launch` for EHR launch, `launch/patient` for standalone), refresh (`offline_access`),
 * and v2 granular clinical scopes for every resource the read/write probes touch.
 */
export const DEFAULT_SCOPE = [
    'openid',
    'fhirUser',
    'launch',
    'launch/patient',
    'offline_access',
    'patient/Patient.rs',
    'patient/Practitioner.rs',
    'patient/PractitionerRole.rs',
    'patient/Organization.rs',
    'patient/Encounter.rs',
    'patient/Condition.rs',
    'patient/DocumentReference.cruds',
    'patient/Binary.cruds',
    'patient/QuestionnaireResponse.cruds',
].join(' ')

export type ClientAuthFixture = {
    clientAuth: MockClientAuthMethod
    authMode: ClientAuthMode
    clientSecret?: string
    clientJwks?: JSONWebKeySet
}

/**
 * Builds matching mock-EHR registration config and this app's own `ClientAuthMode` for a given
 * client authentication method, so both sides of the handshake agree on the same credentials.
 * `private_key_jwt` uses RS384, one of SMART's two required baseline algorithms for asymmetric
 * client authentication.
 */
export async function createClientAuthFixture(clientAuth: MockClientAuthMethod): Promise<ClientAuthFixture> {
    switch (clientAuth) {
        case 'public':
            return { clientAuth, authMode: { type: 'public' } }

        case 'client_secret_basic':
        case 'client_secret_post': {
            const clientSecret = `test-secret-${randomUUID()}`
            return {
                clientAuth,
                clientSecret,
                authMode: { type: 'confidential-symmetric', method: clientAuth, clientSecret },
            }
        }

        case 'private_key_jwt': {
            const keyId = 'integration-test-client-key'
            const { publicKey, privateKey } = await generateKeyPair('RS384', { extractable: true })
            const publicJwk = await exportJWK(publicKey)
            const privateJwk = await exportJWK(privateKey)

            return {
                clientAuth,
                clientJwks: { keys: [{ ...publicJwk, kid: keyId, alg: 'RS384', use: 'sig' }] },
                authMode: {
                    type: 'confidential-asymmetric',
                    privateKeyJwk: JSON.stringify({ ...privateJwk, kid: keyId, alg: 'RS384' }),
                    keyId,
                    algorithm: 'RS384',
                },
            }
        }
    }
}

function createInProcessFetch(app: Hono): typeof fetch {
    return (async (input, init) => {
        const request = input instanceof Request ? input : new Request(input as string | URL, init)
        return app.fetch(request)
    }) as typeof fetch
}

export type LaunchedSmartSession = {
    app: Hono
    recorder: ExchangeRecorder
    httpClient: SmartHttpClient
    sessionStore: SessionStore
    clientId: string
    issuerConfig: IssuerConfig
    session: ActiveSession
    launchContext: LaunchContext
    fhir: FhirClient
}

export type LaunchStage = 'launch' | 'authorize' | 'callback'

export type LaunchOutcome =
    | { ok: true; result: LaunchedSmartSession }
    | { ok: false; stage: LaunchStage; error: SmartError }

export type LaunchOptions = {
    clientAuth?: MockClientAuthMethod
    defects?: Defect[]
    scope?: string
    launchParam?: string
    clientId?: string
    /**
     * When true, `findIssuerConfig` returns `null`, forcing `handleLaunch` down the real RFC
     * 7591 Dynamic Client Registration path: what this app does for any issuer not statically
     * configured in `#core/config/issuers`. Other tests supply a ready-made `issuerConfig` and
     * so never exercise registration at all.
     */
    dynamicClientRegistration?: boolean
}

/**
 * Drives one full launch -> authorize -> code exchange -> token flow against a fresh mock EHR
 * instance, through this app's real `handleLaunch`/`handleCallback`. The "browser" step is
 * simulated directly, since the mock never presents an interactive login.
 */
export async function launchAgainstMockEhr(options: LaunchOptions = {}): Promise<LaunchOutcome> {
    const clientAuth = options.clientAuth ?? 'public'
    const clientId = options.clientId ?? `test-client-${randomUUID()}`
    const scope = options.scope ?? DEFAULT_SCOPE
    const fixture = await createClientAuthFixture(clientAuth)

    const mockConfig: MockEhrConfig = {
        baseUrl: MOCK_EHR_BASE_URL,
        clientAuth,
        clientId,
        clientSecret: fixture.clientSecret,
        clientJwks: fixture.clientJwks,
        defects: options.defects,
    }
    const app = await createMockEhr(mockConfig)
    const recorder = createExchangeRecorder()
    const httpClient = new SmartHttpClient({ recorder, fetchImpl: createInProcessFetch(app) })
    const sessionStore = createInMemorySessionStore()

    const issuerConfig: IssuerConfig = {
        issuer: MOCK_EHR_BASE_URL,
        clientId,
        auth: fixture.authMode,
        dynamicallyRegistered: false,
    }

    const launchResult = await handleLaunch(
        { iss: MOCK_EHR_BASE_URL, launch: options.launchParam ?? 'ehr-launch-context' },
        {
            httpClient,
            recorder,
            sessionStore,
            fetchSmartConfiguration,
            resolveEndpoint,
            findIssuerConfig: () => (options.dynamicClientRegistration ? null : issuerConfig),
            registerClient,
            createPkcePair,
            createOauthState,
            createSessionId: () => randomUUID(),
            redirectUri: APP_REDIRECT_URI,
            scope,
            clientName: APP_CLIENT_NAME,
        },
    )

    if (isSmartError(launchResult)) return { ok: false, stage: 'launch', error: launchResult }

    // The "browser": follows the redirect to the EHR's /authorize, which (having no real user to
    // prompt) immediately redirects back to this app's /callback.
    const authorizeResponse = await app.fetch(new Request(launchResult.redirectUrl))
    if (authorizeResponse.status !== 302) {
        return {
            ok: false,
            stage: 'authorize',
            error: {
                error: 'unexpected_authorize_response',
                detail: `Expected a 302 redirect from /authorize, got ${authorizeResponse.status}`,
            },
        }
    }

    const callbackUrl = new URL(authorizeResponse.headers.get('Location') ?? '', APP_REDIRECT_URI)

    const callbackResult = await handleCallback(
        {
            sessionId: launchResult.sessionId,
            code: callbackUrl.searchParams.get('code') ?? undefined,
            state: callbackUrl.searchParams.get('state') ?? undefined,
            error: callbackUrl.searchParams.get('error') ?? undefined,
            error_description: callbackUrl.searchParams.get('error_description') ?? undefined,
        },
        {
            httpClient,
            recorder,
            sessionStore,
            fetchSmartConfiguration,
            findIssuerConfig: () => (options.dynamicClientRegistration ? null : issuerConfig),
            selectClientAuthentication,
            redirectUri: APP_REDIRECT_URI,
        },
    )

    if (isSmartError(callbackResult)) return { ok: false, stage: 'callback', error: callbackResult }

    const { launchContext } = buildLaunchContext(callbackResult.tokenResponse, callbackResult.idTokenClaims)
    const fhir = new FhirClient({
        http: httpClient,
        baseUrl: callbackResult.fhirBaseUrl,
        accessToken: callbackResult.tokenResponse.access_token,
    })

    return {
        ok: true,
        result: {
            app,
            recorder,
            httpClient,
            sessionStore,
            clientId,
            issuerConfig,
            session: callbackResult,
            launchContext,
            fhir,
        },
    }
}

export async function requireSuccessfulLaunch(options: LaunchOptions = {}): Promise<LaunchedSmartSession> {
    const outcome = await launchAgainstMockEhr(options)
    if (!outcome.ok) {
        throw new Error(
            `Expected the launch to succeed but it failed at stage '${outcome.stage}': ` +
                JSON.stringify(outcome.error),
        )
    }
    return outcome.result
}

export const ALL_CLIENT_AUTH_METHODS: readonly MockClientAuthMethod[] = [
    'public',
    'client_secret_basic',
    'client_secret_post',
    'private_key_jwt',
]
