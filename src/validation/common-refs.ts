export type RefTypes = {
    hl7?: string
    simplifier?: string
    nav?: string
}

export const hl7Refs = {
    patient: 'https://hl7.org/fhir/R4/patient.html',
    practitioner: 'https://hl7.org/fhir/R4/practitioner.html',
    condition: 'https://hl7.org/fhir/R4/condition.html',
    encounter: 'https://hl7.org/fhir/R4/encounter.html',
    documentReference: 'https://hl7.org/fhir/R4/documentreference.html',
    smartLaunch: 'https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html',
    idToken:
        'https://build.fhir.org/ig/HL7/smart-app-launch/scopes-and-launch-context.html#scopes-for-requesting-identity-data',
    organization: 'https://hl7.org/fhir/R4/organization.html',
    binary: 'https://hl7.org/fhir/R4/binary.html',
    bundle: 'https://hl7.org/fhir/R4/bundle.html',
    bundleTransactionRules: 'https://hl7.org/fhir/R4/http.html#trules',
    bundleTransaction: 'https://hl7.org/fhir/R4/http.html#transaction',
    questionnaireResponse: 'https://hl7.org/fhir/R4/questionnaireresponse.html',
    fhirHttpCreate: 'https://hl7.org/fhir/R4/http.html#create',
    fhirHttpSearch: 'https://hl7.org/fhir/R4/http.html#search',
    practitionerRole: 'https://hl7.org/fhir/R4/practitionerrole.html',
    /** The HTTP API chapter: status codes, MIME types, and the RESTful interactions. */
    httpApi: 'https://hl7.org/fhir/R4/http.html',
    /** Search parameters, `Bundle.type = searchset`, and the `_id`/`total` conventions. */
    search: 'https://hl7.org/fhir/R4/search.html',
    resourceList: 'https://hl7.org/fhir/R4/resourcelist.html',
}

export const simplifierRefs = {
    noBasisPasient: 'https://simplifier.net/HL7Norwayno-basis/NoBasisPatient',
    noBasisPractitioner: 'https://simplifier.net/hl7norwayno-basis/nobasispractitioner',
    noBasisOrganization: 'https://simplifier.net/hl7norwayno-basis/NoBasisOrganization',
    noBasisPractitionerRole: 'https://simplifier.net/HL7Norwayno-basis/NoBasisPractitionerRole',
    telecom: 'https://simplifier.net/packages/hl7.fhir.r4.core/4.0.1/files/83048',
}

export const navRefs = {
    patient: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/patient.md',
    practitioner: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/practitioner.md',
    condition: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/condition.md',
    encounter: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/encounter.md',
    documentReference: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/document-reference.md',
    organization: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/organization.md',
    binary: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md',
    bundle: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/bundle.md',
    questionnaireResponse: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/questionnaire-response.md',
    adr01: 'https://github.com/navikt/syk-inn/blob/main/docs/adr/ADR01%20-%20FHIR%20resources%20for%20writing%20data%20back%20to%20EHR.md',
    navRequirements: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md',
    smartGettingStarted: 'https://github.com/navikt/syk-inn/blob/main/docs/smart/getting-started.md',
    smartLaunch: 'https://github.com/navikt/syk-inn/blob/main/docs/smart/smart-launch.md',
    /** No dedicated doc page exists for PractitionerRole; the requirement is in nav-requirements.md. */
    practitionerRole: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md',
}

export const organizationRefs = {}

export const fullRefs = {
    pasient: {
        hl7: hl7Refs.patient,
        simplifier: simplifierRefs.noBasisPasient,
        nav: navRefs.patient,
    },
    practitioner: {
        hl7: hl7Refs.practitioner,
        simplifier: simplifierRefs.noBasisPractitioner,
        nav: navRefs.practitioner,
    },
    condition: {
        hl7: hl7Refs.condition,
        nav: navRefs.condition,
    },
    encounter: {
        hl7: hl7Refs.encounter,
        nav: navRefs.encounter,
    },
    documentReference: {
        hl7: hl7Refs.documentReference,
        nav: navRefs.documentReference,
    },
    organization: {
        hl7: hl7Refs.organization,
    },
    practitionerRole: {
        hl7: hl7Refs.practitionerRole,
        simplifier: simplifierRefs.noBasisPractitionerRole,
        nav: navRefs.practitionerRole,
    },
    binary: {
        hl7: hl7Refs.binary,
        nav: navRefs.binary,
    },
    bundle: {
        hl7: hl7Refs.bundle,
        nav: navRefs.bundle,
    },
    questionnaireResponse: {
        hl7: hl7Refs.questionnaireResponse,
        nav: navRefs.questionnaireResponse,
    },
} satisfies Record<string, RefTypes>
