/**
 * The mock EHR is conformant by default. Every deliberate way it can misbehave is named here, so
 * this union is the single source of truth for what "non-conformant" means in this test suite.
 * Each defect is checked at exactly one place in the mock (noted per group below).
 */
export type Defect =
    // .well-known/smart-configuration (see auth/well-known.ts)
    | 'well-known-missing-required-fields'
    | 'well-known-missing-code-challenge-methods'
    | 'well-known-allows-plain-pkce'
    | 'well-known-relative-urls'
    | 'well-known-404'
    | 'well-known-not-json'
    | 'no-sso-openid-connect'
    // token endpoint (see auth/token.ts)
    | 'token-response-missing-patient-context'
    | 'token-response-missing-encounter-context'
    | 'token-response-missing-scope'
    | 'token-response-narrows-scopes'
    | 'no-refresh-token'
    // id_token (see auth/token.ts)
    | 'id-token-missing-fhir-user'
    | 'id-token-wrong-audience'
    | 'id-token-expired'
    // authorize endpoint (see auth/authorize.ts)
    | 'aud-not-validated'
    // FHIR server (see fhir/metadata.ts)
    | 'fhir-version-r4b'
    | 'fhir-version-r5'
    // resources (see fhir/*.ts)
    | 'patient-missing-identifier'
    | 'patient-wrong-identifier-system'
    | 'practitioner-missing-hpr'
    | 'organization-missing-orgnr'
    | 'encounter-missing-class'
    | 'encounter-missing-service-provider'
    | 'condition-missing-code-system'
    | 'document-reference-search-unsupported'
    | 'document-reference-rejects-binary'
    | 'questionnaire-response-unsupported'
    | 'bundle-transaction-only'

export type DefectSet = {
    has: (defect: Defect) => boolean
    list: () => Defect[]
}

export function createDefectSet(defects: readonly Defect[] = []): DefectSet {
    const set = new Set(defects)

    return {
        has: (defect) => set.has(defect),
        list: () => [...set],
    }
}
