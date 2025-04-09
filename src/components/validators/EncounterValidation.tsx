import { useQuery } from '@tanstack/react-query'
import type { Encounter } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../../utils/ErrorHandler'
import { type Validation, validation } from '../../validation/validation'
import Spinner from '../spinner/Spinner'
import ValidationTable from '../validation-table/ValidationTable'

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
        <ValidationTable validations={[validation(handleError('Unable to fetch Encounter', error), 'ERROR')]} />
      ) : (
        <ValidationTable validations={validations} />
      )}
    </div>
  )
}

function validateEncounter(encounter: Encounter): Validation[] {
  const newValidations: Validation[] = []

  if (encounter.resourceType !== 'Encounter') {
    newValidations.push(validation('Resource is not of type Encounter', 'ERROR'))
  }

  if (!encounter.class) {
    newValidations.push(validation('Encounter does not contain a class object', 'ERROR'))
  } else {
    if (encounter.class.system !== 'http://terminology.hl7.org/CodeSystem/v3-ActCode') {
      newValidations.push(validation('Class system is not http://terminology.hl7.org/CodeSystem/v3-ActCode', 'ERROR'))
    }
    if (!encounter.class.code) {
      newValidations.push(validation('class object is missing code', 'ERROR'))
    } else if (!['AMB', 'VR'].includes(encounter.class.code)) {
      newValidations.push(validation(`Class object code must be AMB, VR, but was "${encounter.class.code}"`, 'ERROR'))
    }
  }

  if (!encounter.subject) {
    newValidations.push(validation('Subject object does not contain a subject', 'ERROR'))
  } else if (!encounter.subject.reference) {
    newValidations.push(validation('reference subject reference is not set', 'ERROR'))
  } else if (!encounter.subject.type) {
    newValidations.push(validation('Subject object does not contain a type', 'ERROR'))
  } else if (!encounter.subject.type.includes('Patient')) {
    newValidations.push(
      validation(`Subject reference is not of type Patient, but was "${encounter.subject.type}"`, 'ERROR'),
    )
  }

  if (!encounter.participant || encounter.participant.length === 0) {
    newValidations.push(validation('Encounter does not contain any participants', 'ERROR'))
  } else {
    encounter.participant.forEach((participant) => {
      if (!participant.individual) {
        newValidations.push(validation('Participant does not contain an individual', 'ERROR'))
      } else if (!participant.individual.reference) {
        newValidations.push(validation('Participant individual reference is not set', 'ERROR'))
      } else if (!participant.individual.reference.includes('Practitioner')) {
        newValidations.push(validation('Participant individual reference is not of type Practitioner', 'ERROR'))
      }
    })
  }

  if (!encounter.period) {
    newValidations.push(validation('Encounter does not contain a period', 'ERROR'))
  } else if (!encounter.period.start) {
    newValidations.push(validation('Encounter period does not contain a start date', 'ERROR'))
  }

  if (!encounter.diagnosis || encounter.diagnosis.length === 0) {
    newValidations.push(validation('Encounter does not contain any diagnosis', 'ERROR'))
  } else {
    encounter.diagnosis.forEach((diagnosis) => {
      if (!diagnosis.condition) {
        newValidations.push(validation('Diagnosis does not contain a condition', 'ERROR'))
      } else if (diagnosis.condition.type !== 'Condition') {
        newValidations.push(
          validation(
            `Diagnosis condition type is not set to "Condition", but was: ${diagnosis.condition.type}`,
            'ERROR',
          ),
        )
      } else if (!diagnosis.condition.reference) {
        newValidations.push(validation('Diagnosis condition reference is not set', 'ERROR'))
      } else if (!diagnosis.condition.reference.includes('Condition')) {
        newValidations.push(validation('Diagnosis condition reference is not of type Condition', 'ERROR'))
      }
    })
  }

  return newValidations
}
