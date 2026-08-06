/**
 * Norwegian national code system OIDs used throughout the synthetic FHIR data.
 * @see https://www.ehelse.no/teknisk-dokumentasjon/oid-identifikatorserier-i-helse-og-omsorgstjenesten
 */
export const OID = {
    fodselsnummer: 'urn:oid:2.16.578.1.12.4.1.4.1',
    dNummer: 'urn:oid:2.16.578.1.12.4.1.4.2',
    hprNummer: 'urn:oid:2.16.578.1.12.4.1.4.4',
    organisasjonsnummer: 'urn:oid:2.16.578.1.12.4.1.4.101',
    icd10: 'urn:oid:2.16.578.1.12.4.1.1.7110',
    icpc2: 'urn:oid:2.16.578.1.12.4.1.1.7170',
    kontakttype: 'urn:oid:2.16.578.1.12.4.1.1.8432',
    documentType: 'urn:oid:2.16.578.1.12.4.1.1.9602',
} as const

export const NO_BASIS_PROFILE = {
    patient: 'http://hl7.no/fhir/StructureDefinition/no-basis-Patient',
    practitioner: 'http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner',
    practitionerRole: 'http://hl7.no/fhir/StructureDefinition/no-basis-PractitionerRole',
    organization: 'http://hl7.no/fhir/StructureDefinition/no-basis-Organization',
} as const
