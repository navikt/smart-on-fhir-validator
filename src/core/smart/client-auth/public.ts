import type { ClientAuthentication } from './index'

/**
 * No client authentication: `client_id` travels in the token request body and PKCE (RFC 7636) is
 * the only protection against code interception.
 *
 * @see https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html#client-types
 */
export function createPublicClientAuthentication(clientId: string): ClientAuthentication {
    return {
        method: 'none',
        formFields: async () => ({ client_id: clientId }),
        headers: async () => ({}),
    }
}
