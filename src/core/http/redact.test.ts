import { describe, expect, it } from 'vitest'

import { redactBody, redactFormBody, redactHeaders, redactJson, redactUrl } from './redact'

const REDACTED = '[REDACTED]'

describe('redactHeaders', () => {
    it.each([
        ['authorization', 'Bearer secret-token'],
        ['Authorization', 'Bearer secret-token'],
        ['cookie', 'session=abc123'],
        ['Set-Cookie', 'session=abc123; HttpOnly'],
        ['proxy-authorization', 'Basic dXNlcjpwYXNz'],
    ])('redacts the %s header regardless of case', (header, value) => {
        const result = redactHeaders({ [header]: value })

        expect(result[header.toLowerCase()]).toBe(REDACTED)
    })

    it('preserves non-sensitive headers untouched', () => {
        const result = redactHeaders({ 'Content-Type': 'application/json', Accept: 'application/fhir+json' })

        expect(result['content-type']).toBe('application/json')
        expect(result['accept']).toBe('application/fhir+json')
    })

    it('accepts a Headers instance, lower-casing all keys', () => {
        const headers = new Headers({ Authorization: 'Bearer secret', 'X-Custom': 'value' })

        const result = redactHeaders(headers)

        expect(result['authorization']).toBe(REDACTED)
        expect(result['x-custom']).toBe('value')
    })

    it('produces an empty object for an empty header set', () => {
        expect(redactHeaders({})).toEqual({})
    })
})

describe('redactUrl', () => {
    it.each([
        'access_token',
        'refresh_token',
        'id_token',
        'client_secret',
        'client_assertion',
        'code',
        'code_verifier',
    ])('redacts the %s query parameter', (param) => {
        const url = redactUrl(`https://ehr.example.com/callback?${param}=super-secret&state=xyz`)

        const parsed = new URL(url)
        expect(parsed.searchParams.get(param)).toBe(REDACTED)
        expect(parsed.searchParams.get('state')).toBe('xyz')
    })

    it.each(['subject', 'encounter', 'type', 'patient', 'category'])(
        'never redacts the FHIR search parameter %s',
        (param) => {
            const url = redactUrl(`https://ehr.example.com/fhir/Observation?${param}=Patient%2F123`)

            const parsed = new URL(url)
            expect(parsed.searchParams.get(param)).toBe('Patient/123')
        },
    )

    it('redacts only the sensitive parameters among a mix of search and credential params', () => {
        const url = redactUrl(
            'https://ehr.example.com/fhir/Encounter?subject=Patient/1&access_token=abc&type=AMB',
        )

        const parsed = new URL(url)
        expect(parsed.searchParams.get('subject')).toBe('Patient/1')
        expect(parsed.searchParams.get('type')).toBe('AMB')
        expect(parsed.searchParams.get('access_token')).toBe(REDACTED)
    })

    it('returns the original string unchanged when it is not a valid URL', () => {
        expect(redactUrl('not a url at all')).toBe('not a url at all')
    })

    it('leaves a URL with no query parameters unchanged', () => {
        expect(redactUrl('https://ehr.example.com/fhir/metadata')).toBe(
            'https://ehr.example.com/fhir/metadata',
        )
    })
})

describe('redactFormBody', () => {
    it('redacts client_secret, code, and code_verifier while preserving other fields', () => {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: 'auth-code-value',
            code_verifier: 'verifier-value',
            client_id: 'my-client',
            client_secret: 'shh',
            redirect_uri: 'https://app.example.com/callback',
        }).toString()

        const result = new URLSearchParams(redactFormBody(body))

        expect(result.get('grant_type')).toBe('authorization_code')
        expect(result.get('client_id')).toBe('my-client')
        expect(result.get('redirect_uri')).toBe('https://app.example.com/callback')
        expect(result.get('code')).toBe(REDACTED)
        expect(result.get('code_verifier')).toBe(REDACTED)
        expect(result.get('client_secret')).toBe(REDACTED)
    })

    it('redacts id_token when present in a form body (token endpoint response re-encoded as form)', () => {
        const body = new URLSearchParams({ id_token: 'jwt-value', scope: 'openid' }).toString()

        const result = new URLSearchParams(redactFormBody(body))

        expect(result.get('id_token')).toBe(REDACTED)
        expect(result.get('scope')).toBe('openid')
    })

    it('handles an empty body', () => {
        expect(redactFormBody('')).toBe('')
    })
})

describe('redactJson', () => {
    it('redacts sensitive keys at the top level', () => {
        const result = redactJson({
            access_token: 'abc',
            refresh_token: 'def',
            client_secret: 'ghi',
            client_assertion: 'jkl',
            code: 'mno',
            code_verifier: 'pqr',
            private_key: 'stu',
            registration_access_token: 'vwx',
            scope: 'patient/*.rs',
        })

        expect(result).toEqual({
            access_token: REDACTED,
            refresh_token: REDACTED,
            client_secret: REDACTED,
            client_assertion: REDACTED,
            code: REDACTED,
            code_verifier: REDACTED,
            private_key: REDACTED,
            registration_access_token: REDACTED,
            scope: 'patient/*.rs',
        })
    })

    it('preserves id_token, deliberately, since it is the subject of validation rather than a bearer credential', () => {
        const result = redactJson({ id_token: 'header.payload.signature', access_token: 'abc' })

        expect(result).toEqual({ id_token: 'header.payload.signature', access_token: REDACTED })
    })

    it('redacts sensitive keys nested inside objects, at any depth', () => {
        const result = redactJson({
            patient: { id: '123' },
            token: { nested: { deeper: { client_secret: 'buried-secret' } } },
        })

        expect(result).toEqual({
            patient: { id: '123' },
            token: { nested: { deeper: { client_secret: REDACTED } } },
        })
    })

    it('redacts sensitive keys inside objects within arrays', () => {
        const result = redactJson([{ access_token: 'a' }, { access_token: 'b', patient: 'Patient/1' }])

        expect(result).toEqual([{ access_token: REDACTED }, { access_token: REDACTED, patient: 'Patient/1' }])
    })

    it('passes through primitives and arrays of primitives unchanged', () => {
        expect(redactJson('hello')).toBe('hello')
        expect(redactJson(42)).toBe(42)
        expect(redactJson(null)).toBeNull()
        expect(redactJson(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    })
})

describe('redactBody', () => {
    it('redacts a form-urlencoded body based on content type', () => {
        const body = new URLSearchParams({
            client_secret: 'shh',
            grant_type: 'authorization_code',
        }).toString()

        const result = redactBody(body, 'application/x-www-form-urlencoded')

        expect(new URLSearchParams(result).get('client_secret')).toBe(REDACTED)
        expect(new URLSearchParams(result).get('grant_type')).toBe('authorization_code')
    })

    it('redacts a form-urlencoded body when the content type includes a charset suffix', () => {
        const body = new URLSearchParams({ client_secret: 'shh' }).toString()

        const result = redactBody(body, 'application/x-www-form-urlencoded; charset=UTF-8')

        expect(new URLSearchParams(result).get('client_secret')).toBe(REDACTED)
    })

    it('redacts a JSON body based on content type', () => {
        const body = JSON.stringify({ client_secret: 'shh', patient: 'Patient/1' })

        const result = redactBody(body, 'application/json')

        expect(JSON.parse(result)).toEqual({ client_secret: REDACTED, patient: 'Patient/1' })
    })

    it('redacts a JSON body for fhir+json content types', () => {
        const body = JSON.stringify({ access_token: 'abc' })

        const result = redactBody(body, 'application/fhir+json')

        expect(JSON.parse(result)).toEqual({ access_token: REDACTED })
    })

    it('returns the body unchanged for content types that are neither form nor JSON', () => {
        const body = '<xml>secret</xml>'

        expect(redactBody(body, 'application/xml')).toBe(body)
    })

    it('returns the body unchanged when content type is null', () => {
        expect(redactBody('plain text body', null)).toBe('plain text body')
    })

    it('returns the raw body unchanged when the content type claims JSON but the body does not parse', () => {
        const body = 'not actually json'

        expect(redactBody(body, 'application/json')).toBe(body)
    })
})
