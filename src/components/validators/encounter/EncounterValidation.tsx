import { useQuery } from '@tanstack/react-query'
import type { Encounter } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

import { validateEncounter } from './validate-encounter'

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
