import type { ClientAuthentication } from './index'

/**
 * https://build.fhir.org/ig/HL7/smart-app-launch/client-confidential-symmetric.html
 *
 * `client_secret_basic` sends credentials via HTTP Basic (RFC 7617); `client_secret_post` sends
 * them as regular form fields. Both are shared-secret ("symmetric") methods.
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
 * RFC 6749 §2.3.1: the client identifier and secret are each individually encoded with the
 * `application/x-www-form-urlencoded` algorithm *before* being joined with a colon and
 * base64-encoded — not simply `base64(clientId + ':' + clientSecret)`. Skipping the per-value
 * form-encoding step is the most common mistake in implementations of this header, and breaks
 * any client_id/secret containing ':', '@', or other reserved characters.
 */
function basicAuthValue(clientId: string, clientSecret: string): string {
    return Buffer.from(`${formUrlEncode(clientId)}:${formUrlEncode(clientSecret)}`, 'utf-8').toString(
        'base64',
    )
}

/** Encodes a single value the same way `URLSearchParams` encodes a form field. */
function formUrlEncode(value: string): string {
    return new URLSearchParams([['v', value]]).toString().slice('v='.length)
}
