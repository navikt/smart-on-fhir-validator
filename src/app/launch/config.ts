/**
 * This app's fixed identity and requested scope when launching against any EHR. Kept separate
 * from `#core/smart/launch` (which only knows how to perform *a* launch, generically) since these
 * are this particular deployment's own choices, not part of the SMART client's contract.
 */

export const APP_CLIENT_NAME = 'Nav SMART on FHIR Validator'

/**
 * Broad enough to exercise every phase the run engine (`#core/run`) checks: identity
 * (`openid`/`fhirUser`), both launch-context forms, refresh (`offline_access`), and v2 granular
 * clinical scopes for every resource the read/write probes touch. A vendor whose authorization
 * server grants a narrower scope than requested is not penalised for it — `#core/run`'s scope and
 * launch-context phases report on exactly what was granted, not what was asked for.
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
 * `handleLaunch` (`#core/smart/launch`) requires a non-empty `launch` parameter unconditionally —
 * it only implements the EHR-launch half of SMART App Launch. A vendor testing standalone (no EHR
 * session, only an `iss`) still needs some value here; an authorization server that does not
 * implement EHR launch has no reason to interpret an unrecognised `launch` parameter, so this
 * fixed placeholder is a safe default for that path.
 */
export const STANDALONE_LAUNCH_PLACEHOLDER = 'standalone'
