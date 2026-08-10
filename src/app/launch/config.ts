/**
 * This app's fixed identity and requested scope when launching against any EHR. Kept separate
 * from `#core/smart/launch`, which only knows how to perform *a* launch generically.
 */

export const APP_CLIENT_NAME = 'Nav SMART on FHIR Validator'

/**
 * Broad enough to exercise every phase the run engine checks: identity (`openid`/`fhirUser`),
 * both launch-context forms, refresh (`offline_access`), and v2 granular clinical scopes for
 * every resource the read/write probes touch. Granting less than requested is not itself a
 * failure — the scope and launch-context phases report on what was granted.
 */
export const APP_SCOPE = [
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

/**
 * `handleLaunch` only implements the EHR-launch half of SMART App Launch, so it always requires a
 * `launch` parameter. A vendor testing standalone (only an `iss`) still needs some value; an
 * authorization server without EHR launch has no reason to interpret an unrecognised one.
 */
export const STANDALONE_LAUNCH_PLACEHOLDER = 'standalone'
