import { useQuery } from '@tanstack/react-query'
import type { Bundle, Condition } from 'fhir/r4'

import type { Client } from '../../../fhir/FakeClient'
import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

import { validateCondition } from './validate-condition'

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
