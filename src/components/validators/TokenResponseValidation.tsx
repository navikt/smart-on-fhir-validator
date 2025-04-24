import Client from 'fhirclient/lib/Client'

import { Validator } from '../../validation/Validator'
import { hl7Refs } from '../../validation/common-refs'
import Validations from '../validation-table/Validations'

export interface Props {
  readonly client: Client
}

/**
 * Validates that data received in the id_token as requested by the `openid`, `profile` and `fhirUser` scopes are
 * present and formulated correctly.
 *
 * @param client - The SMART on FHIR client instance
 */
export default function TokenResponseValidation({ client }: Props) {
  const validations = validateTokenResponse(client)

  return (
    <div>
      <Validations validations={validations} source={client.state.tokenResponse} />
    </div>
  )
}

function validateTokenResponse(client: Client) {
  const validator = new Validator()
  const tokenResponse = client.state.tokenResponse

  if (tokenResponse == null) {
    validator.error('Token response is missing')
    return validator.build()
  }

  if (tokenResponse.encounter == null) {
    validator.error('Encounter is missing')
  }

  if (tokenResponse.patient == null) {
    validator.error('Patient is missing')
  }

  if (tokenResponse.id_token == null) {
    validator.error('ID token is missing')
  }

  if (tokenResponse.access_token == null) {
    validator.error('Access token is missing')
  }

  if (tokenResponse.scope == null) {
    validator.error('Scope is missing')
  }

  if (tokenResponse.token_type != 'Bearer') {
    validator.error('Token type should only be "Bearer"')
  }

  if ('practitioner' in tokenResponse) {
    validator.warn("Found superfluous 'practitioner' in token response, this is not part of the standard", {
      hl7: hl7Refs.idToken,
    })
  }

  return validator.build()
}
