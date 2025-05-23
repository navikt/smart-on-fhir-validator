import type { Practitioner } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { validatePractitioner } from './validate-practitioner'

describe('validatePractitioner', () => {
  it('should validate our own example structure', () => {
    const example: Practitioner = {
      resourceType: 'Practitioner',
      meta: {
        profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner'],
      },
      identifier: [
        {
          system: 'urn:oid:2.16.578.1.12.4.1.4.4',
          value: 'hpr-nummer',
        },
        {
          system: 'urn:oid:2.16.578.1.12.4.1.2',
          value: 'her-id',
        },
      ],
      name: [
        {
          family: 'Koman',
          given: ['Magnar'],
        },
      ],
    }

    const validations = validatePractitioner(example).filter((it) => ['WARN', 'ERROR'].includes(it.severity))

    expect(validations).toEqual([])
  })
})
