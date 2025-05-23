import type { Condition } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { validateCondition } from './validate-condition'

describe('validatePatient', () => {
  it('should validate our own example structure for ICD-10', () => {
    const example: Condition = {
      resourceType: 'Condition',
      id: 'unik Condition ident',
      subject: {
        type: 'Patient',
        reference: 'Pasienten Condition gjelder for',
      },
      code: {
        coding: [
          {
            system: 'urn:oid:2.16.578.1.12.4.1.1.7110',
            display: 'Diagnose',
            code: 'ICD-10 diagnosekode',
          },
        ],
      },
    }

    const validations = validateCondition([example]).filter((it) => ['WARN', 'ERROR'].includes(it.severity))

    expect(validations).toEqual([])
  })

  it('should validate our own example structure for ICPC-2', () => {
    const example: Condition = {
      resourceType: 'Condition',
      id: 'unik Condition ident',
      subject: {
        type: 'Patient',
        reference: 'Pasienten Condition gjelder for',
      },
      code: {
        coding: [
          {
            system: 'urn:oid:2.16.578.1.12.4.1.1.7170',
            display: 'Diagnose',
            code: 'ICPC-2 diagnosekode',
          },
        ],
      },
    }
    const validations = validateCondition([example]).filter((it) => ['WARN', 'ERROR'].includes(it.severity))

    expect(validations).toEqual([])
  })
})
