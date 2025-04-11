import Client from 'fhirclient/lib/Client'

import { authOptions } from '../../fhir/FhirAuth'
import { Validator } from '../../validation/Validator'
import Validations from '../validation-table/Validations'

export interface IdTokenValidationProps {
  readonly client: Client
}

function validateIdToken(client: Client) {
  const scopes: string = authOptions.scope
  const clientId: string = authOptions.clientId
  const idToken = client.getIdToken()

  const allowedResourceTypes = {
    Practitioner: 'Practitioner',
    Patient: 'Patient',
    RelatedPerson: 'RelatedPerson',
  }

  console.debug('ℹ️ Requested OIDC scope(s):', scopes)
  console.debug('ℹ️ ID Token as requested via openid scope:', JSON.stringify(idToken))

  const validator = new Validator()

  if (idToken) {
    const fhirUser = idToken['fhirUser'] as string
    const issuer = idToken.iss
    const audience = idToken.aud

    /**
     * fhirUser claim, if present, is expected to follow the format
     * {resourceType}/{resourceId}. However, in some cases the claim
     * can contain the full URL to the resource, for example:
     *
     * https://fhir.example.com/Practitioner/{practitioner-id}
     *
     * The client library handles this, therefore the url part is
     * ignored. Expected format is therefore
     * {Practitioner | Patient | RelatedPerson}/{resource-id}
     */
    if (!fhirUser) {
      validator.error(`ID token is missing the "fhirUser" claim`)
    } else {
      const split = fhirUser.split('/').slice(-2) // Take the last two segments (resourceType/resourceId)

      if (split.length !== 2) {
        validator.error(
          `"fhirUser" claim is not properly formatted, expected {ResourceType}/{ResourceID} but was ${fhirUser}`,
        )
      } else {
        const [resourceType, resourceId] = split

        // Check if the resourceType is valid
        if (
          ![
            allowedResourceTypes.Practitioner,
            allowedResourceTypes.Patient,
            allowedResourceTypes.RelatedPerson,
          ].includes(resourceType)
        ) {
          validator.error(
            `"fhirUser" claim MUST contain the resource type Practitioner, Patient, or RelatedPerson, but was ${resourceType}`,
          )
        }

        // Validate resource ID is present
        if (!resourceId.trim()) {
          validator.error(`"fhirUser" resource ID must be present`)
        }
      }
    }

    if (!issuer) {
      validator.error(`ID token is missing the "issuer" claim`)
    }

    if (audience) {
      if (audience !== clientId) {
        validator.error(`ID token audience incorrect, it should be ${clientId}, but was ${idToken.aud}`)
      }
    } else {
      validator.error(`ID token is missing the "aud" claim`)
    }
  } else {
    validator.error(`Missing ID token which was requested by the openid scope.`)
  }

  return validator.build()
}

/**
 * Validates that data received in the id_token as requested by the `openid`, `profile` and `fhirUser` scopes are
 * present and formulated correctly.
 *
 * @param client - The SMART on FHIR client instance
 */
export default function IdTokenValidation({ client }: IdTokenValidationProps) {
  const validations = validateIdToken(client)

  return (
    <div>
      <Validations validations={validations} source={client.getIdToken()} />
    </div>
  )
}
