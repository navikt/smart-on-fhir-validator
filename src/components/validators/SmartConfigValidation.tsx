import { useQuery } from '@tanstack/react-query'
import Client from 'fhirclient/lib/Client'

import type { SmartConfiguration } from '../../smart/SmartConfiguration'
import { Validator } from '../../validation/Validator'
import Spinner from '../spinner/Spinner'
import Validations from '../validation-table/Validations'

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

  const validator = new Validator()

  // REQUIRED fields
  if (!config.issuer) {
    validator.error(`issuer is REQUIRED`)
  }
  if (!config.jwks_uri) {
    validator.error(`field jwks_uri is REQUIRED`)
  }
  if (!config.authorization_endpoint) {
    validator.error(`authorization_endpoint is REQUIRED`)
  }
  if (!config.grant_types_supported) {
    validator.error(`grant_types_supported is REQUIRED`)
  }
  if (!config.token_endpoint) {
    validator.error(`token_endpoint is REQUIRED`)
  }
  if (!config.capabilities) {
    validator.error(`capabilities is REQUIRED`)
  }
  if (!config.code_challenge_methods_supported) {
    validator.error(`code_challenge_methods_supported is REQUIRED`)
  }

  // RECOMMENDED fields
  // Removed to focus on the most important fields than Nav requires
  /*if (!config.user_access_brand_bundle) {
    validator.push(validation(`user_access_brand_bundle is RECOMMENDED`, 'WARNING'))
  }
  if (!config.user_access_brand_identifier) {
    validator.push(validation(`user_access_brand_identifier is RECOMMENDED`, 'WARNING'))
  }*/

  if (!config.scopes_supported) {
    validator.warn(`scopes_supported is RECOMMENDED`)
  }
  if (!config.response_types_supported) {
    validator.warn(`response_types_supported is RECOMMENDED`)
  }

  // Removed to focus on the most important fields than Nav requires
  /*if (!config.management_endpoint) {
    validator.warn(`management_endpoint is RECOMMENDED`)
  }*/
  if (!config.introspection_endpoint) {
    validator.warn(`introspection_endpoint is RECOMMENDED`)
  }
  if (!config.revocation_endpoint) {
    validator.warn(`revocation_endpoint is RECOMMENDED`)
  }

  // OPTIONAL fields
  if (!config.token_endpoint_auth_methods_supported) {
    validator.info(`token_endpoint_auth_methods_supported not found`)
  }
  // Removed to focus on the most important fields than Nav requires
  /*if (!config.management_endpoint) {
    validator.warn(`management_endpoint is RECOMMENDED`)
  }
  if (!config.registration_endpoint) {
    validator.info(`registration_endpoint not found`)
  }
  if (!config.associated_endpoints) {
    validator.info(`associated_endpoints not found`)
  }
   */

  return validator.build()
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
      return data
    },
  })

  const validations = data ? validateWellKnown(data) : []

  return (
    <div>
      {isLoading && <Spinner text="Validating well-known/smart-configuration" />}
      {data && <Validations validations={validations} source={data} />}
      {error && (
        <div>
          <h4>An error occurred while fetching .well-known/smart-configuration</h4>
          <p>{error.message}</p>
        </div>
      )}
    </div>
  )
}
