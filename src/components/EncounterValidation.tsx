import { useQuery } from '@tanstack/react-query'
import type { Encounter } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../utils/ErrorHandler'
import { Severity, Validation } from '../utils/Validation'

import Spinner from './spinner/Spinner'
import ValidationTable from './validation-table/ValidationTable'

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
        <ValidationTable
          validations={[new Validation(handleError('Unable to fetch Encounter', error), Severity.ERROR)]}
        />
      ) : (
        <ValidationTable validations={validations} />
      )}
    </div>
  )
}

function validateEncounter(encounter: Encounter): Validation[] {
  const newValidations: Validation[] = []

  if (encounter.resourceType !== 'Encounter') {
    newValidations.push(new Validation('Resource is not of type Encounter', Severity.ERROR))
  }

  if (!encounter.class) {
    newValidations.push(new Validation('Encounter does not contain a class object', Severity.ERROR))
  } else {
    if (encounter.class.system !== 'http://terminology.hl7.org/CodeSystem/v3-ActCode') {
      newValidations.push(
        new Validation('Class system is not http://terminology.hl7.org/CodeSystem/v3-ActCode', Severity.ERROR),
      )
    }
    if (!encounter.class.code) {
      newValidations.push(new Validation('class object is missing code', Severity.ERROR))
    } else if (!['AMB', 'VR'].includes(encounter.class.code)) {
      newValidations.push(
        new Validation(`Class object code must be AMB, VR, but was "${encounter.class.code}"`, Severity.ERROR),
      )
    }
  }

  if (!encounter.subject) {
    newValidations.push(new Validation('Subject object does not contain a subject', Severity.ERROR))
  } else if (!encounter.subject.reference) {
    newValidations.push(new Validation('reference subject reference is not set', Severity.ERROR))
  } else if (!encounter.subject.type) {
    newValidations.push(new Validation('Subject object does not contain a type', Severity.ERROR))
  } else if (!encounter.subject.type.includes('Patient')) {
    newValidations.push(
      new Validation(`Subject reference is not of type Patient, but was "${encounter.subject.type}"`, Severity.ERROR),
    )
  }

  if (!encounter.participant || encounter.participant.length === 0) {
    newValidations.push(new Validation('Encounter does not contain any participants', Severity.ERROR))
  } else {
    encounter.participant.forEach((participant) => {
      if (!participant.individual) {
        newValidations.push(new Validation('Participant does not contain an individual', Severity.ERROR))
      } else if (!participant.individual.reference) {
        newValidations.push(new Validation('Participant individual reference is not set', Severity.ERROR))
      } else if (!participant.individual.reference.includes('Practitioner')) {
        newValidations.push(
          new Validation('Participant individual reference is not of type Practitioner', Severity.ERROR),
        )
      }
    })
  }

  if (!encounter.period) {
    newValidations.push(new Validation('Encounter does not contain a period', Severity.ERROR))
  } else if (!encounter.period.start) {
    newValidations.push(new Validation('Encounter period does not contain a start date', Severity.ERROR))
  }

  if (!encounter.diagnosis || encounter.diagnosis.length === 0) {
    newValidations.push(new Validation('Encounter does not contain any diagnosis', Severity.ERROR))
  } else {
    encounter.diagnosis.forEach((diagnosis) => {
      if (!diagnosis.condition) {
        newValidations.push(new Validation('Diagnosis does not contain a condition', Severity.ERROR))
      } else if (diagnosis.condition.type !== 'Condition') {
        newValidations.push(
          new Validation(
            `Diagnosis condition type is not set to "Condition", but was: ${diagnosis.condition.type}`,
            Severity.ERROR,
          ),
        )
      } else if (!diagnosis.condition.reference) {
        newValidations.push(new Validation('Diagnosis condition reference is not set', Severity.ERROR))
      } else if (!diagnosis.condition.reference.includes('Condition')) {
        newValidations.push(new Validation('Diagnosis condition reference is not of type Condition', Severity.ERROR))
      }
    })
  }

  return newValidations
}
