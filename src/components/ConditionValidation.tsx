import Client from 'fhirclient/lib/Client'
import { useQuery } from '@tanstack/react-query'
import type { Condition } from 'fhir/r4'
import { Severity, Validation } from '../utils/Validation'
import ValidationTable from './validation-table/ValidationTable'
import { handleError } from '../utils/ErrorHandler'
import Spinner from './spinner/Spinner'

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
        <ValidationTable
          validations={[new Validation(handleError('Unable to fetch Condition', error), Severity.ERROR)]}
        />
      ) : (
        <ValidationTable validations={validations} />
      )}
    </div>
  )
}

function validateCondition(condition: Condition): Validation[] {
  const newValidations: Validation[] = []

  if (condition.resourceType !== 'Condition') {
    newValidations.push(new Validation('Resource is not of type Condition', Severity.ERROR))
  }
  if (!condition.subject) {
    newValidations.push(new Validation('Condition object does not contain a subject reference', Severity.ERROR))
  } else if (!condition.subject.reference) {
    newValidations.push(new Validation('The Condition subject object does not contain a reference', Severity.ERROR))
  } else if (!condition.subject.type) {
    newValidations.push(new Validation('The Condition subject object does not contain a type', Severity.ERROR))
  } else if (!condition.subject.type.includes('Patient')) {
    newValidations.push(
      new Validation(
        `The Condition subject must be of type Patient, but was "${condition.subject.type}"`,
        Severity.ERROR,
      ),
    )
  }

  if (!condition.code) {
    newValidations.push(new Validation('Condition object does not contain a code reference', Severity.ERROR))
  } else if (!condition.code.coding) {
    newValidations.push(new Validation('The Condition code object does not contain a coding reference', Severity.ERROR))
  } else {
    const ICD10 = 'urn:oid:2.16.578.1.12.4.1.1.7110'
    const ICPC2 = 'urn:oid:2.16.578.1.12.4.1.1.7170'

    const validCodings = condition.code.coding.filter((code) => code.system === ICD10 || code.system === ICPC2)

    if (validCodings.length === 0) {
      newValidations.push(
        new Validation('The Condition code object does not contain a valid coding reference', Severity.ERROR),
      )
    }

    validCodings.forEach((coding) => {
      if (!coding.code) {
        newValidations.push(new Validation('The Condition coding object does not contain a code', Severity.ERROR))
      }
      if (!coding.display) {
        newValidations.push(
          new Validation('The Condition coding object does not contain a display name', Severity.WARNING),
        )
      }
    })
  }

  return newValidations
}
