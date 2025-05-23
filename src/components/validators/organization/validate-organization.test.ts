import type { Organization } from 'fhir/r4'
import { describe, expect, it } from 'vitest'


import { validateOrganization } from './validate-organization'

describe('validatePatient', () => {
  it('should validate our own example structure', () => {
    const example: Organization = {
      resourceType: 'Organization',
      id: 'unik Organization id',
      meta: {
        profile: ['http://hl7.no/fhir/StructureDefinition/no-basis-Organization'],
      },
      identifier: [
        {
          system: 'urn:oid:2.16.578.1.12.4.1.4.101',
          value: 'org-nummer / ENH',
        },
        {
          system: 'urn:oid:2.16.578.1.12.4.1.4.102',
          value: 'RESH ID / RSH',
        },
      ],
      name: 'Navn på organisasjon',
      telecom: [
        {
          system: 'email',
          value: 'lege@epj.no',
        },
        {
          system: 'phone',
          value: '12345678',
        },
      ],
    }
    const validations = validateOrganization([example]).filter((it) => ['WARN', 'ERROR'].includes(it.severity))

    expect(validations).toEqual([])
  })
})
