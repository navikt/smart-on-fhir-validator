import { useQuery } from '@tanstack/react-query'
import type { Bundle, Condition } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../../../utils/ErrorHandler'
import { Validator } from '../../../validation/Validator'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

export interface ConditionValidationProps {
  readonly client: Client
}

export default function ConditionValidation({ client }: ConditionValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['conditions'],
    queryFn: async () => {
      const conditionBundle = await client.request<Bundle<Condition>>(`Condition?encounter=${client.encounter.id}`)
      console.debug('✅ Condition (Bundle) data fetched')

      if (conditionBundle == null || conditionBundle.resourceType !== 'Bundle') {
        throw new Error(`Resource is not of type Bundle (was: ${conditionBundle?.resourceType}`)
      }

      if (conditionBundle.entry == null || conditionBundle.entry.length === 0) {
        console.debug('No conditions found')
        return conditionBundle
      }

      Object.entries(conditionBundle.entry.map((it) => it.resource).filter((it) => it != null)).forEach(
        ([key, value]) => {
          console.debug(`ℹ️ Condition.${key}:`, value)
        },
      )
      return conditionBundle
    },
  })

  const conditions = data != null && data.entry ? data.entry.map((it) => it.resource).filter((it) => it != null) : []
  const validations: Validation[] = data ? validateCondition(conditions) : []

  return (
    <div>
      {isLoading && <Spinner text="Loading Condition data..." />}
      {error ? (
        <Validations
          validations={[validation(handleError('Unable to fetch Condition', error), 'ERROR')]}
          source={data}
        />
      ) : (
        <Validations validations={validations} source={data} />
      )}
    </div>
  )
}

function validateCondition(conditions: Condition[]): Validation[] {
  const validator = new Validator()

  conditions.forEach((condition, index) => {
    if (condition.resourceType !== 'Condition') {
      validator.error(`[${index}] Resource is not of type Condition`)
    }
    if (!condition.subject) {
      validator.error(`[${index}] Condition object does not contain a subject reference`)
    } else if (!condition.subject.reference) {
      validator.error(`[${index}] The Condition subject object does not contain a reference`)
    } else if (!condition.subject.type) {
      validator.error(`[${index}] The Condition subject object does not contain a type`)
    } else if (!condition.subject.type.includes('Patient')) {
      validator.error(`The Condition subject must be of type Patient, but was "${condition.subject.type}"`)
    }

    if (!condition.code) {
      validator.error(`[${index}] Condition object does not contain a code reference`)
    } else if (!condition.code.coding) {
      validator.error(`[${index}] The Condition code object does not contain a coding reference`)
    } else {
      const ICD10 = 'urn:oid:2.16.578.1.12.4.1.1.7110'
      const ICPC2 = 'urn:oid:2.16.578.1.12.4.1.1.7170'

      const validCodings = condition.code.coding.filter((code) => code.system === ICD10 || code.system === ICPC2)

      if (validCodings.length === 0) {
        validator.error(`[${index}] The Condition code object does not contain a valid coding reference`)
      }

      validCodings.forEach((coding) => {
        if (!coding.code) {
          validator.error(`[${index}] The Condition coding object does not contain a code`)
        }
        if (!coding.display) {
          validator.warn('The Condition coding object does not contain a display name')
        }
      })
    }
  })

  return validator.build()
}
