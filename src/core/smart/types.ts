import type { HttpExchange } from '#core/http/exchange'

/** https://build.fhir.org/ig/HL7/smart-app-launch/conformance.html#capabilities */
export type SmartCapability =
    | 'launch-ehr'
    | 'launch-standalone'
    | 'authorize-post'
    | 'client-public'
    | 'client-confidential-symmetric'
    | 'client-confidential-asymmetric'
    | 'sso-openid-connect'
    | 'context-banner'
    | 'context-style'
    | 'context-ehr-patient'
    | 'context-ehr-encounter'
    | 'context-standalone-patient'
    | 'context-standalone-encounter'
    | 'permission-offline'
    | 'permission-online'
    | 'permission-patient'
    | 'permission-user'
    | 'permission-v1'
    | 'permission-v2'

export type TokenEndpointAuthMethod = 'client_secret_post' | 'client_secret_basic' | 'private_key_jwt'

/**
 * The `.well-known/smart-configuration` document.
 *
 * Every field is optional even where the spec says REQUIRED: a non-conformant document must be
 * parseable so it can be reported on, instead of turning the finding into a crash.
 */
export type SmartConfiguration = {
    issuer?: string
    jwks_uri?: string
    authorization_endpoint?: string
    grant_types_supported?: string[]
    token_endpoint?: string
    token_endpoint_auth_methods_supported?: string[]
    registration_endpoint?: string
    associated_endpoints?: { url?: string; capabilities?: string[] }[]
    user_access_brand_bundle?: string
    user_access_brand_identifier?: string
    scopes_supported?: string[]
    response_types_supported?: string[]
    management_endpoint?: string
    introspection_endpoint?: string
    revocation_endpoint?: string
    capabilities?: string[]
    code_challenge_methods_supported?: string[]
}

/** How this app authenticates itself to a given EHR's token endpoint. */
export type ClientAuthMode =
    | { type: 'public' }
    | {
          type: 'confidential-symmetric'
          method: 'client_secret_basic' | 'client_secret_post'
          clientSecret: string
      }
    | { type: 'confidential-asymmetric'; privateKeyJwk: string; keyId: string; algorithm: 'RS384' | 'ES384' }

/**
 * Per-client registration, from configuration or from dynamic client registration, keyed on the
 * TLS-authenticated FHIR base URL (the `iss` launch parameter), never on the self-declared
 * `issuer` field of a `.well-known/smart-configuration` document. See `resolveIssuerConfig` in
 * `#core/smart/launch` for why.
 */
export type IssuerConfig = {
    fhirBaseUrl: string
    clientId: string
    auth: ClientAuthMode
    /** True when the client was obtained via RFC 7591 rather than static configuration. */
    dynamicallyRegistered: boolean
}

/** The `launch` step: what the app persisted before redirecting the browser to the EHR. */
export type PendingSession = {
    state: 'pending'
    sessionId: string
    fhirBaseUrl: string
    clientId: string
    oauthState: string
    codeVerifier: string
    launch: string
    requestedScope: string
    createdAt: string
    exchanges: HttpExchange[]
}

/** https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html */
export type TokenResponse = {
    access_token: string
    token_type: string
    expires_in?: number
    scope: string
    id_token?: string
    refresh_token?: string
    patient?: string
    encounter?: string
    fhirUser?: string
    need_patient_banner?: boolean
    smart_style_url?: string
    intent?: string
    tenant?: string
}

/** The `callback` step: a completed launch, with tokens and launch context resolved. */
export type ActiveSession = {
    state: 'active'
    sessionId: string
    fhirBaseUrl: string
    clientId: string
    requestedScope: string
    tokenResponse: TokenResponse
    /** Absolute expiry, so refresh does not depend on when the record was read. */
    expiresAt: string
    idTokenClaims: Record<string, unknown> | null
    smartConfiguration: SmartConfiguration
    createdAt: string
    exchanges: HttpExchange[]
}

export type SmartSession = PendingSession | ActiveSession

/**
 * Everything the EHR told us at launch, and nothing more.
 *
 * FHIR probes may only build searches from these values: if a resource cannot be reached from
 * launch context alone, Nav cannot pre-fill from it.
 */
export type LaunchContext = {
    /** From the `patient` token-response parameter. */
    patientId: string | null
    /** From the `encounter` token-response parameter. */
    encounterId: string | null
    /** Relative reference from `fhirUser`, e.g. `Practitioner/123`. */
    fhirUser: string | null
    /** Resource id parsed out of `fhirUser`, when it points at a Practitioner. */
    practitionerId: string | null
    /** Scopes actually granted, which decide which probes are allowed to run. */
    grantedScopes: string[]
}

/** Errors are values here: a failing EHR is the expected case, so it must be reportable. */
export type SmartError = {
    error: string
    detail?: string
    /** The exchange that produced the failure, when there was one. */
    exchangeId?: string
}

export function isSmartError<T extends object>(value: T | SmartError): value is SmartError {
    return 'error' in value
}
