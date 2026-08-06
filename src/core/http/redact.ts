/**
 * Credential stripping for recorded exchanges.
 *
 * Exchanges are rendered to the browser and pasted into support tickets, so anything that could
 * be replayed against the EHR must never survive into an `HttpExchange`. Redaction happens once,
 * at recording time, rather than at render time — a value that is never stored cannot leak.
 *
 * See https://hl7.org/fhir/security.html
 */

const REDACTED = '[REDACTED]'

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])

const SENSITIVE_PARAMS = new Set([
    'access_token',
    'refresh_token',
    'id_token',
    'client_secret',
    'client_assertion',
    'code',
    'code_verifier',
])

/**
 * Keys redacted anywhere in a JSON body, at any depth. `id_token` is deliberately absent: its
 * claims are the subject of validation, it is not a bearer credential, and it is short-lived.
 */
const SENSITIVE_BODY_KEYS = new Set([
    'access_token',
    'refresh_token',
    'client_secret',
    'client_assertion',
    'code',
    'code_verifier',
    'private_key',
    'registration_access_token',
])

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
    const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers)

    return Object.fromEntries(
        entries.map(([key, value]) => [
            key.toLowerCase(),
            SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value,
        ]),
    )
}

/**
 * Redacts sensitive query parameters while keeping the URL readable. A vendor must be able to
 * see the exact search that was issued — that is the point of the report — so only credential
 * parameters are masked, never search parameters.
 */
export function redactUrl(url: string): string {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return url
    }

    for (const key of parsed.searchParams.keys()) {
        if (SENSITIVE_PARAMS.has(key)) parsed.searchParams.set(key, REDACTED)
    }

    return parsed.toString()
}

/** Redacts an `application/x-www-form-urlencoded` body, as used by the token endpoint. */
export function redactFormBody(body: string): string {
    const params = new URLSearchParams(body)
    for (const key of params.keys()) {
        if (SENSITIVE_PARAMS.has(key)) params.set(key, REDACTED)
    }
    return params.toString()
}

export function redactJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redactJson)

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, inner]) => [
                key,
                SENSITIVE_BODY_KEYS.has(key) ? REDACTED : redactJson(inner),
            ]),
        )
    }

    return value
}

export function redactBody(body: string, contentType: string | null): string {
    if (contentType?.includes('application/x-www-form-urlencoded')) return redactFormBody(body)

    if (contentType?.includes('json')) {
        try {
            return JSON.stringify(redactJson(JSON.parse(body)))
        } catch {
            return body
        }
    }

    return body
}
