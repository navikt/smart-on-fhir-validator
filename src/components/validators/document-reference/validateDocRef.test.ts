import type { DocumentReference } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import type { Validation } from '../../../validation/validation'

import { validateDocumentReference } from './validateDocRef'

describe('validateDocRef', () => {
  it('should validate our own example structure', () => {
    const example: DocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      category: [
        {
          coding: [
            {
              system: 'urn:oid:2.16.578.1.12.4.1.1.9602',
              code: 'J01-2',
              display: 'Sykmeldinger og trygdesaker',
            },
          ],
        },
      ],
      subject: {
        reference: 'Pasienten dokumentet gjelder for',
      },
      author: [
        {
          reference: 'Lege som autoriserte dokumentet',
        },
      ],
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
      context: {
        encounter: [{ reference: 'Referanse til encounter fordi Nav loven krever konsultasjon for sykmelding' }],
      },
    }

    const validations = validateDocumentReference(example).filter((it) => isBad(it))

    expect(validations).toEqual([])
  })
})

export function isBad(validation: Validation): boolean {
  return validation.severity !== 'OK' && validation.severity !== 'INFO'
}
