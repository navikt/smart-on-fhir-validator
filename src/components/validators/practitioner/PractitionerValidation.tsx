import { useQuery } from '@tanstack/react-query'
import type { Practitioner } from 'fhir/r4'
import type { Client } from '../../../fhir/FakeClient'

import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

import { validatePractitioner } from './validate-practitioner'

export interface PractitionerValidationProps {
  readonly client: Client
}

export default function PractitionerValidation({ client }: PractitionerValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['encounterValidation', client.fhirUser],
    queryFn: async () => {
      if (client.fhirUser == null) {
        throw new Error('ID-token missing the fhirUser claim. ')
      }
      if (client.fhirUserType !== 'Practitioner') {
        throw new Error(`ID-token fhirUser must be Practitioner, but was "${client.fhirUserType}" `)
      }
      const practitioner = await client.request<Practitioner>(client.fhirUser)
      console.debug('✅ Practitioner data fetched')
      Object.entries(practitioner).forEach(([key, value]) => {
        console.debug(`ℹ️ Practitioner.${key}:`, value)
      })
      return practitioner
    },
  })

  const validations: Validation[] = data ? validatePractitioner(data) : []

  return (
    <div>
      {isLoading && <Spinner text="Loading Practitioner data..." />}
      {error ? (
        <Validations
          validations={[validation(handleError('Unable to fetch Practitioner', error), 'ERROR')]}
          source={data}
        />
      ) : (
        <Validations validations={validations} source={data} />
      )}
    </div>
  )
}
