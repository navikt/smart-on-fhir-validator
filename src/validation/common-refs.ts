export const fhirRefs = {}

export const hl7Refs = {
  noBasisPasient: 'https://simplifier.net/HL7Norwayno-basis/NoBasisPatient',
  noBasisPractitioner: 'https://simplifier.net/hl7norwayno-basis/nobasispractitioner',
}

export const navRefs = {
  pasient: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/pasient.md',
  practitioner: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/practitioner.md',
  condition: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/condition.md',
  encounter: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/encounter.md',
  documentReference: 'https://github.com/navikt/syk-inn/blob/main/docs/fhir/document-reference.md',
}

export const fullRefs = {
  pasient: {
    hl7: hl7Refs.noBasisPasient,
    nav: navRefs.pasient,
  },
  practitioner: {
    hl7: hl7Refs.noBasisPractitioner,
    nav: navRefs.practitioner,
  },
  condition: {
    nav: navRefs.condition,
  },
  encounter: {
    nav: navRefs.encounter,
  },
  documentReference: {
    nav: navRefs.documentReference,
  },
} satisfies Record<
  string,
  {
    fhir?: string
    hl7?: string
    nav?: string
  }
>
