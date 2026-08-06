import type { ClientAuthentication } from './index'

/**
 * https://build.fhir.org/ig/HL7/smart-app-launch/client-confidential-symmetric.html#public-client
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
