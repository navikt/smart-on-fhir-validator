import { useQuery } from '@tanstack/react-query'
import Client from 'fhirclient/lib/Client'

import type { SmartConfiguration } from '../../smart/SmartConfiguration'
import { validation, type Validation } from '../../validation/validation'
import Spinner from '../spinner/Spinner'
import ValidationTable from '../validation-table/ValidationTable'

export interface SmartConfigValidationProps {
  readonly client: Client
}

function getWellKnownUrl(client: Client) {
  const fhirServerUrl: string = client.getState('serverUrl')
  console.debug('ℹ️ FHIR server URL:', fhirServerUrl)

  const urlHasSlashSuffix = fhirServerUrl.endsWith('/')
  let wellKnownSmartConfigURL: string

  if (urlHasSlashSuffix) {
    wellKnownSmartConfigURL = `${fhirServerUrl}.well-known/smart-configuration`
  } else {
    wellKnownSmartConfigURL = `${fhirServerUrl}/.well-known/smart-configuration`
  }
  console.debug('ℹ️ SMART configuration URL:', wellKnownSmartConfigURL)
  return wellKnownSmartConfigURL
}

function validateWellKnown(config: SmartConfiguration) {
  console.debug('ℹ️ .well-known/smart-configuration:', config)

  const newValidations: Validation[] = []

  // REQUIRED fields
  if (!config.issuer) {
    newValidations.push(validation(`issuer is REQUIRED`, 'ERROR'))
  }
  if (!config.jwks_uri) {
    newValidations.push(validation(`field jwks_uri is REQUIRED`, 'ERROR'))
  }
  if (!config.authorization_endpoint) {
    newValidations.push(validation(`authorization_endpoint is REQUIRED`, 'ERROR'))
  }
  if (!config.grant_types_supported) {
    newValidations.push(validation(`grant_types_supported is REQUIRED`, 'ERROR'))
  }
  if (!config.token_endpoint) {
    newValidations.push(validation(`token_endpoint is REQUIRED`, 'ERROR'))
  }
  if (!config.capabilities) {
    newValidations.push(validation(`capabilities is REQUIRED`, 'ERROR'))
  }
  if (!config.code_challenge_methods_supported) {
    newValidations.push(validation(`code_challenge_methods_supported is REQUIRED`, 'ERROR'))
  }

  // RECOMMENDED fields
  if (!config.user_access_brand_bundle) {
    newValidations.push(validation(`user_access_brand_bundle is RECOMMENDED`, 'WARNING'))
  }
  if (!config.user_access_brand_identifier) {
    newValidations.push(validation(`user_access_brand_identifier is RECOMMENDED`, 'WARNING'))
  }
  if (!config.scopes_supported) {
    newValidations.push(validation(`scopes_supported is RECOMMENDED`, 'WARNING'))
  }
  if (!config.response_types_supported) {
    newValidations.push(validation(`response_types_supported is RECOMMENDED`, 'WARNING'))
  }
  if (!config.management_endpoint) {
    newValidations.push(validation(`management_endpoint is RECOMMENDED`, 'WARNING'))
  }
  if (!config.introspection_endpoint) {
    newValidations.push(validation(`introspection_endpoint is RECOMMENDED`, 'WARNING'))
  }
  if (!config.revocation_endpoint) {
    newValidations.push(validation(`revocation_endpoint is RECOMMENDED`, 'WARNING'))
  }

  // OPTIONAL fields
  if (!config.token_endpoint_auth_methods_supported) {
    newValidations.push(validation(`token_endpoint_auth_methods_supported not found`, 'INFO'))
  }
  if (!config.registration_endpoint) {
    newValidations.push(validation(`registration_endpoint not found`, 'INFO'))
  }
  if (!config.associated_endpoints) {
    newValidations.push(validation(`associated_endpoints not found`, 'INFO'))
  }

  return newValidations
}

/**
 * Validates that the smart-configuration metadata follows the requirements as defined by the [SMART
 * framework](https://hl7.org/fhir/smart-app-launch/conformance.html#metadata).
 *
 * This will NOT validate the contents, only that required, recommended or optional fields are present.
 *
 * @param client - The SMART on FHIR client instance
 */
export default function SmartConfigValidation({ client }: SmartConfigValidationProps) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['wellKnown'],
    queryFn: async () => {
      const wellKnownSmartConfigURL = getWellKnownUrl(client)

      const result = await fetch(wellKnownSmartConfigURL)

      if (!result.ok) {
        throw new Error(`Unable to fetch well-known/smart-configuration. ${result.status} ${result.statusText}`)
      }

      const data: SmartConfiguration = await result.json()
      return validateWellKnown(data)
    },
  })

  return (
    <div>
      {isLoading && <Spinner text="Validating well-known/smart-configuration" />}
      {data && <ValidationTable validations={data} />}
      {error && (
        <div>
          <h4>An error occurred while fetching .well-known/smart-configuration</h4>
          <p>{error.message}</p>
        </div>
      )}
    </div>
  )
}
