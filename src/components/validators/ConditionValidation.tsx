import { useQuery } from '@tanstack/react-query'
import type { Condition } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../../utils/ErrorHandler'
import { Validator } from '../../validation/Validator'
import { type Validation, validation } from '../../validation/validation'
import Spinner from '../spinner/Spinner'
import ValidationTable from '../validation-table/ValidationTable'

export interface ConditionValidationProps {
  readonly client: Client
}

export default function ConditionValidation({ client }: ConditionValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['encounterValidation', client.user.fhirUser],
    queryFn: async () => {
      if (client.user.fhirUser == null) {
        throw new Error('ID-token missing the fhirUser claim. ')
      }
      if (client.getUserType() !== 'Condition') {
        throw new Error(`ID-token fhirUser must be Condition, but was "${client.getUserType()}" `)
      }
      const condition = await client.request<Condition>(client.user.fhirUser)
      console.debug('✅ Condition data fetched')
      Object.entries(condition).forEach(([key, value]) => {
        console.debug(`ℹ️ Condition.${key}:`, value)
      })
      return condition
    },
  })

  const validations: Validation[] = data ? validateCondition(data) : []

  return (
    <div>
      {isLoading && <Spinner text="Loading Condition data..." />}
      {error ? (
        <ValidationTable validations={[validation(handleError('Unable to fetch Condition', error), 'ERROR')]} />
      ) : (
        <ValidationTable validations={validations} />
      )}
    </div>
  )
}

function validateCondition(condition: Condition): Validation[] {
  const validator = new Validator()

  if (condition.resourceType !== 'Condition') {
    validator.error('Resource is not of type Condition')
  }
  if (!condition.subject) {
    validator.error('Condition object does not contain a subject reference')
  } else if (!condition.subject.reference) {
    validator.error('The Condition subject object does not contain a reference')
  } else if (!condition.subject.type) {
    validator.error('The Condition subject object does not contain a type')
  } else if (!condition.subject.type.includes('Patient')) {
    validator.error(`The Condition subject must be of type Patient, but was "${condition.subject.type}"`)
  }

  if (!condition.code) {
    validator.error('Condition object does not contain a code reference')
  } else if (!condition.code.coding) {
    validator.error('The Condition code object does not contain a coding reference')
  } else {
    const ICD10 = 'urn:oid:2.16.578.1.12.4.1.1.7110'
    const ICPC2 = 'urn:oid:2.16.578.1.12.4.1.1.7170'

    const validCodings = condition.code.coding.filter((code) => code.system === ICD10 || code.system === ICPC2)

    if (validCodings.length === 0) {
      validator.error('The Condition code object does not contain a valid coding reference')
    }

    validCodings.forEach((coding) => {
      if (!coding.code) {
        validator.error('The Condition coding object does not contain a code')
      }
      if (!coding.display) {
        validator.warn('The Condition coding object does not contain a display name')
      }
    })
  }

  return validator.build()
}
