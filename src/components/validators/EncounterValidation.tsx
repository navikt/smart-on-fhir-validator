import { useQuery } from '@tanstack/react-query'
import type { Encounter } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../../utils/ErrorHandler'
import { Validator } from '../../validation/Validator'
import { type Validation, validation } from '../../validation/validation'
import Spinner from '../spinner/Spinner'
import Validations from '../validation-table/Validations'

export interface EncounterValidationProps {
  readonly client: Client
}

export default function EncounterValidation({ client }: EncounterValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['encounterValidation', client.encounter.id],
    queryFn: async () => {
      const encounter = await client.request<Encounter>(`Encounter/${client.encounter.id}`)

      console.debug('✅ Encounter data fetched')
      Object.entries(encounter).forEach(([key, value]) => {
        console.debug(`ℹ️ Encounter.${key}:`, value)
      })

      return encounter
    },
  })

  const validations: Validation[] = data ? validateEncounter(data) : []

  return (
    <div>
      {isLoading && <Spinner text="Loading Encounter data..." />}
      {error ? (
        <Validations
          validations={[validation(handleError('Unable to fetch Encounter', error), 'ERROR')]}
          source={data}
        />
      ) : (
        <Validations validations={validations} source={data} />
      )}
    </div>
  )
}

function validateEncounter(encounter: Encounter): Validation[] {
  const validator = new Validator()

  if (encounter.resourceType !== 'Encounter') {
    validator.error('Resource is not of type Encounter')
  }

  if (!encounter.class) {
    validator.error('Encounter does not contain a class object')
  } else {
    if (encounter.class.system !== 'http://terminology.hl7.org/CodeSystem/v3-ActCode') {
      validator.error('Class system is not http://terminology.hl7.org/CodeSystem/v3-ActCode')
    }
    if (!encounter.class.code) {
      validator.error('class object is missing code')
    } else if (!['AMB', 'VR'].includes(encounter.class.code)) {
      validator.error(`Class object code must be AMB, VR, but was "${encounter.class.code}"`)
    }
  }

  if (!encounter.subject) {
    validator.error('Subject object does not contain a subject')
  } else if (!encounter.subject.reference) {
    validator.error('reference subject reference is not set')
  } else if (!encounter.subject.type) {
    validator.error('Subject object does not contain a type')
  } else if (!encounter.subject.type.includes('Patient')) {
    validator.error(`Subject reference is not of type Patient, but was "${encounter.subject.type}"`)
  }

  if (!encounter.participant || encounter.participant.length === 0) {
    validator.error('Encounter does not contain any participants')
  } else {
    encounter.participant.forEach((participant) => {
      if (!participant.individual) {
        validator.error('Participant does not contain an individual')
      } else if (!participant.individual.reference) {
        validator.error('Participant individual reference is not set')
      } else if (!participant.individual.reference.includes('Practitioner')) {
        validator.error('Participant individual reference is not of type Practitioner')
      }
    })
  }

  if (!encounter.period) {
    validator.error('Encounter does not contain a period')
  } else if (!encounter.period.start) {
    validator.error('Encounter period does not contain a start date')
  }

  if (!encounter.diagnosis || encounter.diagnosis.length === 0) {
    validator.error('Encounter does not contain any diagnosis')
  } else {
    encounter.diagnosis.forEach((diagnosis) => {
      if (!diagnosis.condition) {
        validator.error('Diagnosis does not contain a condition')
      } else if (diagnosis.condition.type !== 'Condition') {
        validator.error(`Diagnosis condition type is not set to "Condition", but was: ${diagnosis.condition.type}`)
      } else if (!diagnosis.condition.reference) {
        validator.error('Diagnosis condition reference is not set')
      } else if (!diagnosis.condition.reference.includes('Condition')) {
        validator.error('Diagnosis condition reference is not of type Condition')
      }
    })
  }

  return validator.build()
}
