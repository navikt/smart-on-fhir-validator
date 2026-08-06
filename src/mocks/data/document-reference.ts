import type { Binary, DocumentReference } from 'fhir/r4'

import { OID } from './oid'
import { ENCOUNTER_ID } from './encounter'
import { PATIENT_ID } from './patient'

export const DOCUMENT_REFERENCE_ID = 'document-reference-sykmelding'
export const BINARY_ID = 'binary-sykmelding-pdf'

/** A minimal, valid, synthetic one-page PDF ("Synthetic test sykmelding PDF") — never real content. */
const SYNTHETIC_PDF_BASE64 =
    'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDEwMF0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDQgMCBSPj4+Pi9Db250ZW50cyA1IDAgUj4+ZW5kb2JqCjQgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iago1IDAgb2JqPDwvTGVuZ3RoIDU4Pj5zdHJlYW0KQlQgL0YxIDEyIFRmIDEwIDUwIFRkIChTeW50aGV0aWMgdGVzdCBzeWttZWxkaW5nIFBERikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCnRyYWlsZXI8PC9TaXplIDYvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgowCiUlRU9G'

export function createSeedBinary(): Binary {
    return {
        resourceType: 'Binary',
        id: BINARY_ID,
        contentType: 'application/pdf',
        data: SYNTHETIC_PDF_BASE64,
    }
}

export function createSeedDocumentReference(): DocumentReference {
    return {
        resourceType: 'DocumentReference',
        id: DOCUMENT_REFERENCE_ID,
        status: 'current',
        type: { coding: [{ system: OID.documentType, code: 'J01-2', display: 'Sykmelding' }] },
        subject: { reference: `Patient/${PATIENT_ID}` },
        context: { encounter: [{ reference: `Encounter/${ENCOUNTER_ID}` }] },
        content: [{ attachment: { contentType: 'application/pdf', url: `Binary/${BINARY_ID}` } }],
    }
}
