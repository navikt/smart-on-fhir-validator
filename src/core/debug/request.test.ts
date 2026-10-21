import { describe, expect, it } from 'vitest'

import { isSmartError } from '#core/smart/types'

import {
    type DebugRequest,
    MAX_DEBUG_BODY_BYTES,
    MAX_DEBUG_QUERY_LENGTH,
    buildDebugUrl,
    normaliseMethod,
    validateDebugRequest,
} from './request'

const BASE = 'https://ehr.example.com/fhir'

function request(overrides: Partial<DebugRequest> = {}): DebugRequest {
    return {
        method: 'GET',
        resourceType: 'Patient',
        id: '123',
        query: '',
        body: null,
        contentType: null,
        authentication: 'session',
        customToken: null,
        ...overrides,
    }
}

function rejection(overrides: Partial<DebugRequest>) {
    const result = validateDebugRequest(request(overrides))
    expect(isSmartError(result)).toBe(true)
    return result
}

describe('method', () => {
    it('uppercases a valid token', () => {
        expect(normaliseMethod('get')).toBe('GET')
        expect(validateDebugRequest(request({ method: 'patch' }))).toMatchObject({ method: 'PATCH' })
    })

    it.each(['GE T', ' GET', 'GET ', '\tGET\n', 'GET\r\nX: y', '', 'GÉT', 'GET/1', '(GET)'])(
        'rejects non-token method %j',
        (method) => {
            expect(rejection({ method })).toMatchObject({ error: 'invalid_request' })
        },
    )

    it.each(['CONNECT', 'trace', 'TRACK'])('rejects %s', (method) => {
        expect(rejection({ method })).toMatchObject({ error: 'invalid_request' })
    })

    it('accepts other valid tokens', () => {
        expect(validateDebugRequest(request({ method: 'purge' }))).toMatchObject({ method: 'PURGE' })
    })
})

describe('path grammar', () => {
    it.each([
        ['Patient', '123', '/fhir/Patient/123'],
        ['Patient', '', '/fhir/Patient'],
        ['Patient', '123/_history', '/fhir/Patient/123/_history'],
        ['Patient', '123/_history/2', '/fhir/Patient/123/_history/2'],
        ['Patient', '123/$everything', '/fhir/Patient/123/$everything'],
        ['Patient', '$match', '/fhir/Patient/$match'],
        ['Patient', '_history', '/fhir/Patient/_history'],
        ['Patient', '_search', '/fhir/Patient/_search'],
        ['metadata', '', '/fhir/metadata'],
        ['_history', '', '/fhir/_history'],
        ['$export', '', '/fhir/$export'],
        ['', '', '/fhir'],
    ])('accepts %j / %j', (resourceType, id, pathname) => {
        const url = buildDebugUrl(BASE, request({ resourceType, id }))
        expect(isSmartError(url)).toBe(false)
        expect((url as URL).pathname).toBe(pathname)
    })

    it.each([
        ['lowercase type', { resourceType: 'patient' }],
        ['digit in type', { resourceType: 'Patient2' }],
        ['absolute URL as type', { resourceType: 'http://evil.example.com' }],
        ['absolute URL as id', { id: 'http://evil.example.com/x' }],
        ['scheme-relative id', { id: '//evil.example.com' }],
        ['parent directory id', { id: '..' }],
        ['current directory id', { id: '.' }],
        ['traversal in id', { id: '../other' }],
        ['traversal in type', { resourceType: '..' }],
        ['encoded slash', { id: '1%2F2' }],
        ['encoded dot', { id: '%2e%2e' }],
        ['backslash', { id: '1\\2' }],
        ['query in id', { id: '1?x=y' }],
        ['fragment in id', { id: '1#x' }],
        ['query in type', { resourceType: 'Patient?x=y' }],
        ['whitespace', { id: '1 2' }],
        ['empty segment', { id: '1//_history' }],
        ['trailing slash', { id: '1/' }],
        ['leading slash', { id: '/1' }],
        ['id over 64 chars', { id: 'a'.repeat(65) }],
        ['id with underscore', { id: 'a_b' }],
        ['id with non-ASCII', { id: 'æ' }],
        ['too many segments', { id: '1/_history/2/3' }],
        ['unknown suffix', { id: '1/other' }],
        ['bad version id', { id: '1/_history/..' }],
        ['operation with bad name', { id: '1/$a b' }],
        ['metadata with id', { resourceType: 'metadata', id: '1' }],
        ['metadata via POST', { resourceType: 'metadata', id: '', method: 'POST' }],
        ['id without type', { resourceType: '', id: '1' }],
        ['id on _history', { resourceType: '_history', id: '1' }],
        ['id on system operation', { resourceType: '$export', id: '1' }],
    ])('rejects %s', (_name, overrides) => {
        expect(rejection(overrides)).toMatchObject({ error: 'invalid_request' })
    })
})

describe('query', () => {
    it('is encoded through URLSearchParams', () => {
        const url = buildDebugUrl(
            BASE,
            request({ resourceType: 'Condition', id: '', query: 'code=a b&x=%C3%A6' }),
        )
        expect((url as URL).search).toBe('?code=a+b&x=%C3%A6')
    })

    it('tolerates a single leading question mark', () => {
        const url = buildDebugUrl(BASE, request({ id: '', query: '?_count=1' }))
        expect((url as URL).search).toBe('?_count=1')
    })

    it('rejects a fragment', () => {
        expect(rejection({ query: 'a=1#frag' })).toMatchObject({ error: 'invalid_request' })
    })

    it('rejects an overlong query and accepts the limit', () => {
        expect(rejection({ query: 'a'.repeat(MAX_DEBUG_QUERY_LENGTH + 1) })).toMatchObject({
            error: 'invalid_request',
        })
        expect(
            isSmartError(validateDebugRequest(request({ query: 'a'.repeat(MAX_DEBUG_QUERY_LENGTH) }))),
        ).toBe(false)
    })
})

describe('authentication', () => {
    it('defaults to the session token when the fields are omitted', () => {
        const { authentication: _a, customToken: _c, ...legacy } = request()

        expect(validateDebugRequest(legacy)).toMatchObject({ authentication: 'session', customToken: null })
    })

    it('accepts none and a valid custom token', () => {
        expect(validateDebugRequest(request({ authentication: 'none' }))).toMatchObject({
            authentication: 'none',
        })
        expect(
            validateDebugRequest(request({ authentication: 'custom', customToken: 'abc.DEF-1_2~3+/=' })),
        ).toMatchObject({ authentication: 'custom', customToken: 'abc.DEF-1_2~3+/=' })
    })

    it.each([
        ['an unknown mode', { authentication: 'basic' }],
        ['a non-string token', { authentication: 'custom', customToken: 123 }],
        ['a missing token', { authentication: 'custom', customToken: null }],
        ['an empty token', { authentication: 'custom', customToken: '' }],
        ['a token with a space', { authentication: 'custom', customToken: 'abc def' }],
        ['a token with CRLF', { authentication: 'custom', customToken: 'abc\r\nX-Evil: 1' }],
        ['a token that is too long', { authentication: 'custom', customToken: 'a'.repeat(16385) }],
        ['a token in session mode', { authentication: 'session', customToken: 'secret-token' }],
        ['a token in none mode', { authentication: 'none', customToken: 'secret-token' }],
    ])('rejects %s without echoing the input', (_name, overrides) => {
        const result = validateDebugRequest({ ...request(), ...overrides })

        expect(result).toMatchObject({ error: 'invalid_request' })
        const text = JSON.stringify(result)
        expect(text).not.toContain('secret-token')
        expect(text).not.toContain('Evil')
        expect(text).not.toContain('abc')
    })
})

describe('body', () => {
    const body = '{"resourceType":"Patient"}'

    it.each(['GET', 'HEAD', 'DELETE'])('rejects a body on %s', (method) => {
        expect(rejection({ method, body, contentType: 'application/fhir+json' })).toMatchObject({
            error: 'invalid_request',
        })
    })

    it.each(['POST', 'PUT', 'PATCH', 'PURGE'])('accepts a FHIR JSON body on %s', (method) => {
        expect(
            isSmartError(
                validateDebugRequest(request({ method, body, contentType: 'application/fhir+json' })),
            ),
        ).toBe(false)
    })

    it('requires body and content type together', () => {
        expect(rejection({ method: 'POST', body, contentType: null })).toMatchObject({
            error: 'invalid_request',
        })
        expect(rejection({ method: 'POST', body: null, contentType: 'application/fhir+json' })).toMatchObject(
            {
                error: 'invalid_request',
            },
        )
    })

    it('allows json-patch only on PATCH', () => {
        expect(
            isSmartError(
                validateDebugRequest(
                    request({ method: 'PATCH', body: '[]', contentType: 'application/json-patch+json' }),
                ),
            ),
        ).toBe(false)
        expect(
            rejection({ method: 'POST', body: '[]', contentType: 'application/json-patch+json' }),
        ).toMatchObject({
            error: 'invalid_request',
        })
    })

    it('rejects other content types', () => {
        expect(rejection({ method: 'POST', body, contentType: 'text/plain' as never })).toMatchObject({
            error: 'invalid_request',
        })
    })

    it('limits the body by UTF-8 bytes, not characters', () => {
        const atLimit = 'a'.repeat(MAX_DEBUG_BODY_BYTES)
        const multibyte = 'æ'.repeat(MAX_DEBUG_BODY_BYTES / 2 + 1)

        expect(
            isSmartError(
                validateDebugRequest(
                    request({ method: 'POST', body: atLimit, contentType: 'application/fhir+json' }),
                ),
            ),
        ).toBe(false)
        expect(
            rejection({ method: 'POST', body: `${atLimit}a`, contentType: 'application/fhir+json' }),
        ).toMatchObject({
            error: 'invalid_request',
        })
        expect(
            rejection({ method: 'POST', body: multibyte, contentType: 'application/fhir+json' }),
        ).toMatchObject({
            error: 'invalid_request',
        })
    })
})

describe('URL containment', () => {
    it('keeps the base path, including with a trailing slash', () => {
        const url = buildDebugUrl('https://ehr.example.com/a/b/fhir/', request())
        expect((url as URL).href).toBe('https://ehr.example.com/a/b/fhir/Patient/123')
    })

    it('works for a base without a path', () => {
        const url = buildDebugUrl('http://localhost:3001', request({ resourceType: 'metadata', id: '' }))
        expect((url as URL).href).toBe('http://localhost:3001/metadata')
    })

    it('keeps the port and origin', () => {
        const url = buildDebugUrl('https://ehr.example.com:8443/fhir', request())
        expect((url as URL).origin).toBe('https://ehr.example.com:8443')
    })

    it('rejects an invalid request before building', () => {
        expect(buildDebugUrl(BASE, request({ id: '..' }))).toMatchObject({ error: 'invalid_request' })
    })

    it('rejects an unparseable base', () => {
        expect(buildDebugUrl('not a url', request())).toMatchObject({ error: 'invalid_request' })
    })
})
