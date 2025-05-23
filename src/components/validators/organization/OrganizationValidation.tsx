import { useQuery } from '@tanstack/react-query'
import type { Bundle, Organization } from 'fhir/r4'
import type Client from 'fhirclient/lib/Client'

import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

import { validateOrganization } from './validate-organization'

export interface OrganizationValidationProps {
  readonly client: Client
}

export default function OrganizationValidation({ client }: OrganizationValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['organizationValidation', client.getFhirUser()],
    queryFn: async () => {
      const organizationBundle = await client.request<Bundle<Organization>>(`Organization`) // TODO: Fetch practitionerRole first and get key

      console.debug('✅ Organization data fetched')
      Object.entries(organizationBundle).forEach(([key, value]) => {
        console.debug(`ℹ️ Organization.${key}:`, JSON.stringify(value))
      })

      if (organizationBundle == null || organizationBundle.resourceType !== 'Bundle') {
        throw new Error(`Resource is not of type Bundle (was: ${organizationBundle?.resourceType}`)
      }

      if (organizationBundle.entry == null || organizationBundle.entry.length === 0) {
        console.debug('No organizations found')
        return organizationBundle
      }

      return organizationBundle
    },
  })

  const organizations = data != null && data.entry ? data.entry.map((it) => it.resource).filter((it) => it != null) : []

  const validations: Validation[] = data ? validateOrganization(organizations) : []
  return (
    <div>
      {isLoading && <Spinner text="Loading Organization data..." />}
      {error ? (
        <Validations
          validations={[validation(handleError('Unable to fetch Organization', error), 'ERROR')]}
          source={data}
        />
      ) : (
        <Validations validations={validations} source={data} />
      )}
    </div>
  )
}

