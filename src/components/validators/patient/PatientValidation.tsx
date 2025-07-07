import { useQuery } from '@tanstack/react-query'
import type { Patient } from 'fhir/r4'
import type { Client } from '../../../fhir/FakeClient'

import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

import { validatePatient } from './validate-patient'

export interface PatientValidationProps {
  readonly client: Client
}

export default function PatientValidation({ client }: PatientValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['encounterValidation', client.patient.id],
    queryFn: async () => {
      const patient = await client.request<Patient>(`Patient/${client.patient.id}`)

      console.debug('✅ Patient data fetched')
      Object.entries(patient).forEach(([key, value]) => {
        console.debug(`ℹ️ Patient.${key}:`, JSON.stringify(value))
      })

      return patient
    },
  })

  const validations: Validation[] = data ? validatePatient(data) : []

  return (
    <div>
      {isLoading && <Spinner text="Loading Patient data..." />}
      {error ? (
        <Validations validations={[validation(handleError('Unable to fetch Patient', error), 'ERROR')]} source={data} />
      ) : (
        <Validations validations={validations} source={data} />
      )}
    </div>
  )
}
