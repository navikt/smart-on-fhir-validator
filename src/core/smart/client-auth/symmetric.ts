import type { ClientAuthentication } from './index'

/**
 * `client_secret_basic` sends the shared secret via HTTP Basic (RFC 7617), `client_secret_post`
 * as form fields.
 *
 * @see https://build.fhir.org/ig/HL7/smart-app-launch/client-confidential-symmetric.html
 */
export function createSymmetricClientAuthentication(
    clientId: string,
    clientSecret: string,
    method: 'client_secret_basic' | 'client_secret_post',
): ClientAuthentication {
    if (method === 'client_secret_post') {
        return {
            method,
            formFields: async () => ({ client_id: clientId, client_secret: clientSecret }),
            headers: async () => ({}),
        }
    }

    return {
        method,
        formFields: async () => ({}),
        headers: async () => ({ Authorization: `Basic ${basicAuthValue(clientId, clientSecret)}` }),
    }
}

/**
 * RFC 6749 §2.3.1: client id and secret are each form-urlencoded *before* being joined with a
 * colon and base64-encoded — not `base64(clientId + ':' + clientSecret)`. Skipping the per-value
 * encoding is the most common mistake here, and breaks any value containing ':' or '@'.
 */
function basicAuthValue(clientId: string, clientSecret: string): string {
    return Buffer.from(`${formUrlEncode(clientId)}:${formUrlEncode(clientSecret)}`, 'utf-8').toString(
        'base64',
    )
}

function formUrlEncode(value: string): string {
    return new URLSearchParams([['v', value]]).toString().slice('v='.length)
}
