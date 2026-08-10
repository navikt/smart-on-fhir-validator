import type { ClientAuthentication } from './index'

/**
 * https://hl7.org/fhir/smart-app-launch/STU2.2/conformance.html#client-types
 *
 * No client authentication at all: `client_id` travels in the token request body, and PKCE
 * (RFC 7636) is the only protection against code interception/replay.
 */
export function createPublicClientAuthentication(clientId: string): ClientAuthentication {
    return {
        method: 'none',
        formFields: async () => ({ client_id: clientId }),
        headers: async () => ({}),
    }
}
