import Client from 'fhirclient/lib/Client'

import { authOptions } from '../../fhir/FhirAuth'
import { validation, type Validation } from '../../validation/Validation'
import ValidationTable from '../validation-table/ValidationTable'

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

  const newValidations: Validation[] = []

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
      newValidations.push(validation(`ID token is missing the "fhirUser" claim`, 'ERROR'))
    } else {
      const split = fhirUser.split('/').slice(-2) // Take the last two segments (resourceType/resourceId)

      if (split.length !== 2) {
        newValidations.push(
          validation(
            `"fhirUser" claim is not properly formatted, expected {ResourceType}/{ResourceID} but was ${fhirUser}`,
            'ERROR',
          ),
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
          newValidations.push(
            validation(
              `"fhirUser" claim MUST contain the resource type Practitioner, Patient, or RelatedPerson, but was ${resourceType}`,
              'ERROR',
            ),
          )
        }

        // Validate resource ID is present
        if (!resourceId.trim()) {
          newValidations.push(validation(`"fhirUser" resource ID must be present`, 'ERROR'))
        }
      }
    }

    if (!issuer) {
      newValidations.push(validation(`ID token is missing the "issuer" claim`, 'ERROR'))
    }

    if (audience) {
      if (audience !== clientId) {
        newValidations.push(
          validation(`ID token audience incorrect, it should be ${clientId}, but was ${idToken.aud}`, 'ERROR'),
        )
      }
    } else {
      newValidations.push(validation(`ID token is missing the "aud" claim`, 'ERROR'))
    }
  } else {
    newValidations.push(validation(`Missing ID token which was requested by the openid scope.`, 'ERROR'))
  }

  return newValidations
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
      <ValidationTable validations={validations} />
    </div>
  )
}
