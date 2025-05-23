import type { Encounter } from 'fhir/r4'
import { describe, expect, it } from 'vitest'


import { validateEncounter } from './validate-encounter'

describe('validateEncounter', () => {
  it('should validate our own example structure', () => {
    const example: Encounter = {
      resourceType: 'Encounter',
      id: 'unik encounter ident',
      status: 'in-progress',
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: 'AMB | VR',
      },
      subject: {
        reference: 'Patient/<Pasienten encounter gjelder for>',
      },
      participant: [
        {
          individual: {
            reference: 'Practitioner/<Lege som startet encounteret>',
          },
        },
      ],
      period: {
        start: 'dato og tid konsultasjonen startet',
      },
      diagnosis: [
        {
          condition: {
            type: 'Condition',
            reference: 'Referanse til Condition i FHIR API',
          },
        },
      ],
    }
    const validations = validateEncounter(example).filter((it) => ['WARN', 'ERROR'].includes(it.severity))

    expect(validations).toEqual([])
  })
})
