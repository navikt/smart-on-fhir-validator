import type { Encounter } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import { validateEncounter } from './validate-encounter'

describe('validateEncounter', () => {
  it('should validate our own example structure', () => {
    const example: Encounter = {
      resourceType: 'Encounter',
      id: 'unik encounter ident',
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
      diagnosis: [
        {
          condition: {
            reference: 'Condition/<Referanse til Condition i FHIR API>',
          },
        },
      ],
      serviceProvider: {
        reference: 'Organization/<Helseforetaket som utfører konsultasjonen>',
      },
      status: 'in-progress',
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: 'AMB | VR',
      },
    }
    const validations = validateEncounter(example).filter((it) => ['WARN', 'ERROR'].includes(it.severity))

    expect(validations).toEqual([])
  })
})
