import {
    FHIR_JSON,
    JSON_PATCH,
    MAX_DEBUG_BODY_BYTES,
    type AuthenticationMode,
    normaliseMethod,
    utf8ByteLength,
    validateDebugRequest,
    type DebugRequest,
} from '#core/debug/request'

export const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'Other'] as const

export type MethodOption = (typeof METHOD_OPTIONS)[number]

export type RequestDraft = {
    resourceType: string
    id: string
    method: MethodOption
    otherMethod: string
    query: string
    body: string
    contentType: typeof FHIR_JSON | typeof JSON_PATCH
    authentication: AuthenticationMode
}

export const EMPTY_DRAFT: RequestDraft = {
    resourceType: '',
    id: '',
    method: 'GET',
    otherMethod: '',
    query: '',
    body: '',
    contentType: FHIR_JSON,
    authentication: 'session',
}

export type DraftResult = { ok: true; request: DebugRequest } | { ok: false; error: string }

const QUERY_METHODS = new Set(['GET', 'HEAD'])
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'DELETE'])

export function effectiveMethod(draft: RequestDraft): string {
    return normaliseMethod(draft.method === 'Other' ? draft.otherMethod : draft.method)
}

export function allowsQuery(method: string): boolean {
    return QUERY_METHODS.has(method)
}

export function allowsBody(method: string): boolean {
    return method !== '' && !BODYLESS_METHODS.has(method)
}

export function isWrite(method: string): boolean {
    return !QUERY_METHODS.has(method)
}

const CUSTOM_TOKEN_JSON_START = /^[{["]/
const CUSTOM_TOKEN_NOT_FOUND =
    'This response does not contain an access token. Copy the value labelled access_token from the sign-in response.'

export type CustomTokenResult = { ok: true; token: string } | { ok: false; error: string }

export function extractCustomToken(input: string): CustomTokenResult {
    const trimmed = input.trim()
    if (!CUSTOM_TOKEN_JSON_START.test(trimmed)) return { ok: true, token: trimmed }

    if (utf8ByteLength(trimmed) > MAX_DEBUG_BODY_BYTES) {
        return { ok: false, error: `The pasted text may not exceed ${MAX_DEBUG_BODY_BYTES} bytes.` }
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        return {
            ok: false,
            error: 'We could not read this response. Copy the entire response again, or paste just the access token.',
        }
    }

    const token =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>).access_token
            : undefined
    if (typeof token !== 'string' || token.trim() === '') {
        return { ok: false, error: CUSTOM_TOKEN_NOT_FOUND }
    }
    return { ok: true, token: token.trim() }
}

export function buildRequest(draft: RequestDraft, customToken = ''): DraftResult {
    const method = effectiveMethod(draft)
    if (method === '') return { ok: false, error: 'Enter a method.' }

    const body = allowsBody(method) && draft.body !== '' ? draft.body : null

    if (body !== null) {
        if (utf8ByteLength(body) > MAX_DEBUG_BODY_BYTES) {
            return { ok: false, error: `The body may not exceed ${MAX_DEBUG_BODY_BYTES} bytes.` }
        }
        try {
            JSON.parse(body)
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'Parse error'
            return { ok: false, error: `The body is not valid JSON: ${reason}` }
        }
    }

    const contentType = body === null ? null : method === 'PATCH' ? draft.contentType : FHIR_JSON

    let token: string | null = null
    if (draft.authentication === 'custom') {
        const extracted = extractCustomToken(customToken)
        if (!extracted.ok) return extracted
        token = extracted.token
    }

    const validated = validateDebugRequest({
        method,
        resourceType: draft.resourceType,
        id: draft.id,
        query: allowsQuery(method) ? draft.query.replace(/^\?/, '') : '',
        body,
        contentType,
        authentication: draft.authentication,
        customToken: token,
    })

    if ('error' in validated) return { ok: false, error: validated.detail ?? validated.error }

    return { ok: true, request: validated }
}
