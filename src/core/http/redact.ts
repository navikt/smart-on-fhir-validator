/**
 * Credential stripping for recorded exchanges.
 *
 * Exchanges are rendered to the browser and pasted into support tickets, so anything that could
 * be replayed against the EHR must never survive into an `HttpExchange`. Redaction happens once,
 * at recording time, rather than at render time: a value that is never stored cannot leak.
 *
 * See https://hl7.org/fhir/security.html
 */

const REDACTED = '[REDACTED]'

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization'])

const REPORT_PARAMS = new Set([
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
const REPORT_BODY_KEYS = new Set([
    'access_token',
    'refresh_token',
    'client_secret',
    'client_assertion',
    'code',
    'code_verifier',
    'private_key',
    'registration_access_token',
])

export type RedactionSets = {
    params: ReadonlySet<string>
    bodyKeys: ReadonlySet<string>
}

export const REPORT_REDACTION: RedactionSets = { params: REPORT_PARAMS, bodyKeys: REPORT_BODY_KEYS }

/** Credential-only: the FHIR `code` search parameter and element are data the user is inspecting. */
export const DEBUG_REDACTION: RedactionSets = {
    params: new Set([...REPORT_PARAMS].filter((key) => key !== 'code')),
    bodyKeys: new Set([...REPORT_BODY_KEYS].filter((key) => key !== 'code')),
}

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
 * see the exact search that was issued (that is the point of the report), so only credential
 * parameters are masked, never search parameters.
 */
export function redactUrl(url: string, sets: RedactionSets = REPORT_REDACTION): string {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return url
    }

    for (const key of parsed.searchParams.keys()) {
        if (sets.params.has(key)) parsed.searchParams.set(key, REDACTED)
    }

    return parsed.toString()
}

/** Redacts an `application/x-www-form-urlencoded` body, as used by the token endpoint. */
export function redactFormBody(body: string, sets: RedactionSets = REPORT_REDACTION): string {
    const params = new URLSearchParams(body)
    for (const key of params.keys()) {
        if (sets.params.has(key)) params.set(key, REDACTED)
    }
    return params.toString()
}

export function redactJson(value: unknown, sets: RedactionSets = REPORT_REDACTION): unknown {
    if (Array.isArray(value)) return value.map((item) => redactJson(item, sets))

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, inner]) => [
                key,
                sets.bodyKeys.has(key) ? REDACTED : redactJson(inner, sets),
            ]),
        )
    }

    return value
}

export function redactBody(
    body: string,
    contentType: string | null,
    sets: RedactionSets = REPORT_REDACTION,
): string {
    if (contentType?.includes('application/x-www-form-urlencoded')) return redactFormBody(body, sets)

    if (contentType?.includes('json')) {
        try {
            return JSON.stringify(redactJson(JSON.parse(body), sets))
        } catch {
            return body
        }
    }

    return body
}
