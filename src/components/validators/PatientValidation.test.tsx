import type { Patient } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { validatePatient } from './PatientValidation'

describe('validatePatient', () => {
  it('should validate our own example structure', () => {
    const example: Patient = {
      resourceType: 'Patient',
      meta: {
        profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Patient'],
      },
      id: 'unik Patient ident',
      identifier: [
        {
          system: 'urn:oid:2.16.578.1.12.4.1.4.1',
          value: 'fødselsnummer',
        },
        {
          system: 'urn:oid:2.16.578.1.12.4.1.4.2',
          value: 'd-nummer',
        },
      ],
      name: [
        {
          family: 'Etternavn',
          given: ['Fornavn'],
        },
      ],
    }

    const validations = validatePatient(example).filter((it) => ['WARN', 'ERROR'].includes(it.severity))

    expect(validations).toEqual([])
  })
})
