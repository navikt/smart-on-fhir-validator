import type { DocumentReference } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import type { Validation } from '../../../validation/validation'

import { validateDocumentReference } from './validateDocRef'

const workingDocumentReference: DocumentReference = {
  resourceType: 'DocumentReference',
  id: 'foo-bar-baz',
  description: 'Generell forklaring av dokumentet',
  content: [
    {
      attachment: {
        title: 'Tittel generert av Nav',
        language: 'NO-nb',
        contentType: 'application/pdf',
        data: 'base64 PDF',
      },
    },
  ],
  type: {
    coding: [
      {
        system: 'urn:oid:2.16.578.1.12.4.1.1.9602',
        code: 'J01-2',
        display: 'Sykmeldinger og trygdesaker',
      },
    ],
  },
  subject: { reference: 'Patient/<Pasient ID dokumentet gjelder for>' },
  author: [{ reference: 'Practitioner/<Behandler ID som autoriserte dokumentet>' }],
  context: {
    encounter: [
      { reference: 'Encounter/<Referanse til encounter fordi Nav loven krever konsultasjon for sykmelding>' },
    ],
  },
  status: 'current',
}

describe('validateDocRef', () => {
  it('should validate our own example structure', () => {
    const validations = validateDocumentReference(workingDocumentReference, 'foo-bar-baz').filter((it) => isBad(it))

    expect(validations).toEqual([])
  })

  it('should complain if ID returned is different than ID provided in payload', () => {
    const validations = validateDocumentReference(workingDocumentReference, 'wrong-id').filter((it) => isBad(it))

    expect(validations).toHaveLength(1)

    const [first] = validations
    expect(first.severity).toEqual('ERROR')
    expect(first.message).toBe(
      'DocumentReference.id was not the same as the provided ID, was foo-bar-baz, expected wrong-id',
    )
  })
})

export function isBad(validation: Validation): boolean {
  return validation.severity !== 'OK' && validation.severity !== 'INFO'
}
