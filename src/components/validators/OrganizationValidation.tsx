import { useQuery } from '@tanstack/react-query'
import type { Bundle, Organization } from 'fhir/r4'
import type Client from 'fhirclient/lib/Client'
import Spinner from 'src/components/spinner/Spinner'
import Validations from 'src/components/validation-table/Validations'
import { handleError } from 'src/utils/ErrorHandler'
import { Validator } from 'src/validation/Validator'
import { navRefs, simplifierRefs } from 'src/validation/common-refs'
import { type Validation, validation } from 'src/validation/validation'

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

const ENH_IDENTIFIER_SYSTEM = 'urn:oid:2.16.578.1.12.4.1.4.101'

function validateOrganization(fhirOrganizations: Organization[]): Validation[] {
  const validator = new Validator()

  fhirOrganizations.forEach((organization, index) => {
    const meta = organization.meta
    if (
      !meta ||
      !meta.profile ||
      !meta.profile.includes('http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner')
    ) {
      validator.error('The Practitioner must be of type no-basis-Practitioner', {
        simplifier: simplifierRefs.noBasisOrganization,
        nav: navRefs.organization,
      })
    }
    if (organization.resourceType !== 'Organization') {
      validator.error(`[${index}] Resource is not of type Organization`)
    }
    const identifier = organization.identifier?.find((id) => id.system === ENH_IDENTIFIER_SYSTEM)
    if (!identifier) {
      validator.error(
        `[${index}] The organization does not have an identifier of type ENH (oid: ${ENH_IDENTIFIER_SYSTEM})`,
        {
          nav: navRefs.organization,
        },
      )
    }
    if (!organization.name) {
      validator.error(`[${index}] Organization.name is required`)
    }
    organization.telecom?.forEach((telecom, telecomIndex) => {
      if (!telecom.system) {
        validator.error(`[${index}].telecom[${telecomIndex}].system is required`, {
          simplifier: simplifierRefs.telecom,
          nav: navRefs.organization,
        })
      }
      if (!telecom.value) {
        validator.error(`[${index}].telecom[${telecomIndex}].value is required`, {
          simplifier: simplifierRefs.telecom,
          nav: navRefs.organization,
        })
      }
    })
  })

  return validator.build()
}
