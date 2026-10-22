import * as z from 'zod'

import type { SmartError } from '#core/smart/types'

export const MAX_DEBUG_BODY_BYTES = 1024 * 1024
export const MAX_DEBUG_QUERY_LENGTH = 2048

export const FHIR_JSON = 'application/fhir+json'
export const JSON_PATCH = 'application/json-patch+json'

const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK'])
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'DELETE'])
const READ_ONLY_METHODS = new Set(['GET', 'HEAD'])

const TYPE_SEGMENT = /^[A-Z][A-Za-z]{0,63}$/
const OPERATION_SEGMENT = /^\$[A-Za-z][A-Za-z0-9-]{0,63}$/
const ID_SEGMENT = /^[A-Za-z0-9\-.]{1,64}$/
const UNSAFE_PATH_CHARACTERS = /[\\?#%\s]/u

export const AUTHENTICATION_MODES = ['session', 'none', 'custom'] as const
export type AuthenticationMode = (typeof AUTHENTICATION_MODES)[number]

export const MAX_CUSTOM_TOKEN_LENGTH = 16384
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/

export const debugRequestSchema = z.object({
    method: z.string(),
    resourceType: z.string(),
    id: z.string(),
    query: z.string(),
    body: z.string().nullable(),
    contentType: z.enum([FHIR_JSON, JSON_PATCH]).nullable(),
    authentication: z.enum(AUTHENTICATION_MODES).default('session'),
    customToken: z.string().nullable().default(null),
})

export type DebugRequest = z.infer<typeof debugRequestSchema>

export function normaliseMethod(method: string): string {
    return method.toUpperCase()
}

export function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

function invalid(detail: string): SmartError {
    return { error: 'invalid_request', detail }
}

function isValidId(segment: string): boolean {
    return ID_SEGMENT.test(segment) && segment !== '.' && segment !== '..'
}

function checkCustomToken(request: DebugRequest): SmartError | null {
    const { authentication, customToken } = request

    if (authentication !== 'custom') {
        return customToken === null
            ? null
            : invalid('A custom access token can only be used with the Custom token option.')
    }
    if (customToken === null || customToken === '') return invalid('Enter a custom access token.')
    if (customToken.length > MAX_CUSTOM_TOKEN_LENGTH) {
        return invalid(`The custom access token may not exceed ${MAX_CUSTOM_TOKEN_LENGTH} characters.`)
    }
    if (!BEARER_TOKEN.test(customToken)) {
        return invalid('The custom access token must be a valid bearer token without spaces or line breaks.')
    }

    return null
}

function checkMethod(method: string): SmartError | null {
    if (!METHOD_TOKEN.test(method)) return invalid('The method must be an HTTP token such as GET or POST.')
    if (FORBIDDEN_METHODS.has(method)) return invalid(`The ${method} method is not allowed.`)

    return null
}

function checkPathText(label: string, value: string): SmartError | null {
    if (UNSAFE_PATH_CHARACTERS.test(value)) {
        return invalid(
            `The ${label} may not contain backslashes, '?', '#', '%' or whitespace. Put search parameters in the query field.`,
        )
    }
    if (value.includes(':')) return invalid(`The ${label} must be a relative FHIR path, not a URL.`)
    if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
        return invalid(`The ${label} may not contain empty path segments.`)
    }
    if (value.split('/').some((segment) => segment === '.' || segment === '..')) {
        return invalid(`The ${label} may not contain '.' or '..' segments.`)
    }

    return null
}

function checkIdBox(id: string): SmartError | null {
    const segments = id.split('/')
    const [first = '', second = '', third = ''] = segments

    if (segments.length === 1) {
        if (
            first === '_history' ||
            first === '_search' ||
            OPERATION_SEGMENT.test(first) ||
            isValidId(first)
        ) {
            return null
        }
        return invalid(
            'The id must be 1-64 characters of letters, digits, hyphens and dots, or one of _history, _search or $operation.',
        )
    }

    if (!isValidId(first)) {
        return invalid('The id must be 1-64 characters of letters, digits, hyphens and dots.')
    }
    if (segments.length === 2 && (second === '_history' || OPERATION_SEGMENT.test(second))) return null
    if (segments.length === 3 && second === '_history' && isValidId(third)) return null

    return invalid('The id may only be followed by _history, _history/{versionId} or an $operation.')
}

function checkPath(request: DebugRequest, method: string): SmartError | null {
    const { resourceType, id } = request

    const textError = checkPathText('resource type', resourceType) ?? checkPathText('id', id)
    if (textError) return textError

    if (resourceType === '') {
        return id === '' ? null : invalid('The id must be empty when no resource type is given.')
    }

    if (resourceType === 'metadata') {
        if (id !== '') return invalid('metadata does not take an id.')
        return READ_ONLY_METHODS.has(method) ? null : invalid('metadata can only be read with GET or HEAD.')
    }

    if (resourceType === '_history' || OPERATION_SEGMENT.test(resourceType)) {
        return id === '' ? null : invalid(`${resourceType} does not take an id.`)
    }

    if (!TYPE_SEGMENT.test(resourceType)) {
        return invalid(
            'The resource type must start with an uppercase letter and contain only letters, or be metadata, _history or an $operation.',
        )
    }

    return id === '' ? null : checkIdBox(id)
}

function checkBody(request: DebugRequest, method: string): SmartError | null {
    const { body, contentType } = request

    if (body === null && contentType === null) return null
    if (body === null || contentType === null) {
        return invalid('The body and the content type must be given together.')
    }
    if (BODYLESS_METHODS.has(method)) return invalid(`${method} requests cannot have a body.`)
    if (contentType === JSON_PATCH && method !== 'PATCH') {
        return invalid(`${JSON_PATCH} is only allowed with PATCH.`)
    }
    if (utf8ByteLength(body) > MAX_DEBUG_BODY_BYTES) {
        return invalid(`The request body may not exceed ${MAX_DEBUG_BODY_BYTES} bytes.`)
    }

    return null
}

function checkQuery(query: string): SmartError | null {
    if (query.length > MAX_DEBUG_QUERY_LENGTH) {
        return invalid(`The query may not exceed ${MAX_DEBUG_QUERY_LENGTH} characters.`)
    }
    if (query.includes('#')) return invalid("The query may not contain '#'.")

    return null
}

export function validateDebugRequest(input: unknown): DebugRequest | SmartError {
    const parsed = debugRequestSchema.safeParse(input)
    if (!parsed.success) return invalid(z.prettifyError(parsed.error))

    const method = normaliseMethod(parsed.data.method)
    const request = { ...parsed.data, method }

    return (
        checkCustomToken(request) ??
        checkMethod(method) ??
        checkPath(request, method) ??
        checkQuery(request.query) ??
        checkBody(request, method) ??
        request
    )
}

function joinPath(request: DebugRequest): string {
    return [request.resourceType, request.id].filter((part) => part !== '').join('/')
}

export function buildDebugUrl(baseUrl: string, input: DebugRequest): URL | SmartError {
    const request = validateDebugRequest(input)
    if ('error' in request) return request

    let base: URL
    try {
        base = new URL(baseUrl)
    } catch {
        return invalid('The session FHIR base URL is not a valid URL.')
    }

    const basePath = base.pathname.replace(/\/+$/, '')
    const path = joinPath(request)
    const url = new URL(`${base.origin}${basePath}${path === '' ? '' : `/${path}`}`)
    url.search = new URLSearchParams(request.query.replace(/^\?/, '')).toString()

    const withinBase = url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)
    if (url.origin !== base.origin || !withinBase) {
        return invalid('The request resolves outside the FHIR base URL.')
    }

    return url
}
