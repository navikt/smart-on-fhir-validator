/**
 * The spec-citation model every finding's `refs` is built from. A citation names the authority
 * that makes a finding a finding (`authority`), the exact clause a reader can cross-check it
 * against (`cite`, taken from the target section's heading text), and the URL to that clause
 * (`href`). Authority is always stated explicitly, never guessed from the URL.
 */
export type SpecAuthority = 'smart' | 'fhir' | 'oauth' | 'oidc' | 'no-basis' | 'nav'

export type SpecRef = {
    authority: SpecAuthority
    /** The human citation, and the link text shown in the report. */
    cite: string
    href: string
}

export type RefTypes = readonly SpecRef[]

export const hl7Refs = {
    patient: { authority: 'fhir', cite: 'FHIR R4 §Patient', href: 'https://hl7.org/fhir/R4/patient.html' },
    practitioner: {
        authority: 'fhir',
        cite: 'FHIR R4 §Practitioner',
        href: 'https://hl7.org/fhir/R4/practitioner.html',
    },
    condition: {
        authority: 'fhir',
        cite: 'FHIR R4 §Condition',
        href: 'https://hl7.org/fhir/R4/condition.html',
    },
    encounter: {
        authority: 'fhir',
        cite: 'FHIR R4 §Encounter',
        href: 'https://hl7.org/fhir/R4/encounter.html',
    },
    documentReference: {
        authority: 'fhir',
        cite: 'FHIR R4 §DocumentReference',
        href: 'https://hl7.org/fhir/R4/documentreference.html',
    },
    smartLaunch: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §App Launch: Launch and Authorization',
        href: 'https://hl7.org/fhir/smart-app-launch/STU2.2/app-launch.html',
    },
    idToken: {
        authority: 'smart',
        cite: 'SMART App Launch 2.2 §Scopes for requesting identity data',
        href: 'https://hl7.org/fhir/smart-app-launch/STU2.2/scopes-and-launch-context.html#scopes-for-requesting-identity-data',
    },
    organization: {
        authority: 'fhir',
        cite: 'FHIR R4 §Organization',
        href: 'https://hl7.org/fhir/R4/organization.html',
    },
    binary: { authority: 'fhir', cite: 'FHIR R4 §Binary', href: 'https://hl7.org/fhir/R4/binary.html' },
    bundle: { authority: 'fhir', cite: 'FHIR R4 §Bundle', href: 'https://hl7.org/fhir/R4/bundle.html' },
    /** Batch Processing Rules: entry structure and the inter-entry reference constraints that apply
     *  specifically to a `batch` (as opposed to a `transaction`) Bundle. */
    bundleBatchRules: {
        authority: 'fhir',
        cite: 'FHIR R4 §Batch processing rules',
        href: 'https://hl7.org/fhir/R4/http.html#brules',
    },
    bundleTransaction: {
        authority: 'fhir',
        cite: 'FHIR R4 §batch/transaction',
        href: 'https://hl7.org/fhir/R4/http.html#transaction',
    },
    questionnaireResponse: {
        authority: 'fhir',
        cite: 'FHIR R4 §QuestionnaireResponse',
        href: 'https://hl7.org/fhir/R4/questionnaireresponse.html',
    },
    fhirHttpCreate: {
        authority: 'fhir',
        cite: 'FHIR R4 §create',
        href: 'https://hl7.org/fhir/R4/http.html#create',
    },
    fhirHttpSearch: {
        authority: 'fhir',
        cite: 'FHIR R4 §search',
        href: 'https://hl7.org/fhir/R4/http.html#search',
    },
    /** `PUT` as update-as-create ("upsert"): 201 when no resource existed yet, 200 when it did. */
    fhirHttpUpsert: {
        authority: 'fhir',
        cite: 'FHIR R4 §Update as Create',
        href: 'https://hl7.org/fhir/R4/http.html#upsert',
    },
    practitionerRole: {
        authority: 'fhir',
        cite: 'FHIR R4 §PractitionerRole',
        href: 'https://hl7.org/fhir/R4/practitionerrole.html',
    },
    /** The HTTP API chapter: status codes, MIME types, and the RESTful interactions. */
    httpApi: { authority: 'fhir', cite: 'FHIR R4 §HTTP API', href: 'https://hl7.org/fhir/R4/http.html' },
    /** Search parameters, `Bundle.type = searchset`, and the `_id`/`total` conventions. */
    search: { authority: 'fhir', cite: 'FHIR R4 §Search', href: 'https://hl7.org/fhir/R4/search.html' },
    resourceList: {
        authority: 'fhir',
        cite: 'FHIR R4 §Resource List',
        href: 'https://hl7.org/fhir/R4/resourcelist.html',
    },
    /** The authority is FHIR R4 itself, not the no-basis profile: the simplifier.net link
     *  this used to carry in `simplifierRefs` returned HTTP 404, so do not move it back. */
    telecom: {
        authority: 'fhir',
        cite: 'FHIR R4 §ContactPoint',
        href: 'https://hl7.org/fhir/R4/datatypes.html#ContactPoint',
    },
} satisfies Record<string, SpecRef>

export const simplifierRefs = {
    noBasisPasient: {
        authority: 'no-basis',
        cite: 'no-basis §NoBasisPatient',
        href: 'https://simplifier.net/HL7Norwayno-basis/NoBasisPatient',
    },
    noBasisPractitioner: {
        authority: 'no-basis',
        cite: 'no-basis §NoBasisPractitioner',
        href: 'https://simplifier.net/hl7norwayno-basis/nobasispractitioner',
    },
    noBasisOrganization: {
        authority: 'no-basis',
        cite: 'no-basis §NoBasisOrganization',
        href: 'https://simplifier.net/hl7norwayno-basis/NoBasisOrganization',
    },
    noBasisPractitionerRole: {
        authority: 'no-basis',
        cite: 'no-basis §NoBasisPractitionerRole',
        href: 'https://simplifier.net/HL7Norwayno-basis/NoBasisPractitionerRole',
    },
} satisfies Record<string, SpecRef>

export const navRefs = {
    patient: {
        authority: 'nav',
        cite: 'Nav §Patient',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/patient.md',
    },
    practitioner: {
        authority: 'nav',
        cite: 'Nav §Practitioner',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/practitioner.md',
    },
    condition: {
        authority: 'nav',
        cite: 'Nav §Condition',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/condition.md',
    },
    encounter: {
        authority: 'nav',
        cite: 'Nav §Encounter',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/encounter.md',
    },
    documentReference: {
        authority: 'nav',
        cite: 'Nav §DocumentReference',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/document-reference.md',
    },
    organization: {
        authority: 'nav',
        cite: 'Nav §Organization',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/organization.md',
    },
    /** No dedicated doc page exists for Binary; the requirement is in nav-requirements.md. */
    binary: {
        authority: 'nav',
        cite: 'Nav §Navs krav til helsevirksomheter og EPJ-leverandører',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md',
    },
    bundle: {
        authority: 'nav',
        cite: 'Nav §Bundle',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/bundle.md',
    },
    questionnaireResponse: {
        authority: 'nav',
        cite: 'Nav §QuestionnaireResponse',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/questionnaire-response.md',
    },
    adr01: {
        authority: 'nav',
        cite: 'Nav §ADR01 - FHIR Resources for writing data back to EHR',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/adr/ADR01%20-%20FHIR%20resources%20for%20writing%20data%20back%20to%20EHR.md',
    },
    navRequirements: {
        authority: 'nav',
        cite: 'Nav §Navs krav til helsevirksomheter og EPJ-leverandører',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md',
    },
    smartGettingStarted: {
        authority: 'nav',
        cite: 'Nav §Getting started with SMART on FHIR',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/smart/getting-started.md',
    },
    smartLaunch: {
        authority: 'nav',
        cite: 'Nav §Secure implementation of SMART on FHIR launch',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/smart/smart-launch.md',
    },
    /** No dedicated doc page exists for PractitionerRole; the requirement is in nav-requirements.md. */
    practitionerRole: {
        authority: 'nav',
        cite: 'Nav §Navs krav til helsevirksomheter og EPJ-leverandører',
        href: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md',
    },
} satisfies Record<string, SpecRef>

export const fullRefs = {
    documentReference: [hl7Refs.documentReference, navRefs.documentReference],
    binary: [hl7Refs.binary, navRefs.binary],
    bundle: [hl7Refs.bundle, navRefs.bundle],
    questionnaireResponse: [hl7Refs.questionnaireResponse, navRefs.questionnaireResponse],
} satisfies Record<string, RefTypes>
