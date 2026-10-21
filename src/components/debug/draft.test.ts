import { describe, expect, it } from 'vitest'

import { MAX_DEBUG_BODY_BYTES } from '#core/debug/request'

import { allowsBody, allowsQuery, buildRequest, EMPTY_DRAFT, isWrite, type RequestDraft } from './draft'

const draft = (overrides: Partial<RequestDraft>): RequestDraft => ({ ...EMPTY_DRAFT, ...overrides })

describe('buildRequest', () => {
    it('builds a GET with no leading question mark on the query', () => {
        expect(buildRequest(draft({ resourceType: 'Patient', id: '123', query: '?_summary=true' }))).toEqual({
            ok: true,
            request: {
                method: 'GET',
                resourceType: 'Patient',
                id: '123',
                query: '_summary=true',
                body: null,
                contentType: null,
                authentication: 'session',
                customToken: null,
            },
        })
    })

    describe('custom token input', () => {
        const custom = draft({ authentication: 'custom' })
        const tokenOf = (input: string) => {
            const result = buildRequest(custom, input)
            return result.ok ? result.request.customToken : result
        }

        it('trims a raw token and rejects internal whitespace', () => {
            expect(tokenOf('  abc.def.ghi\n')).toBe('abc.def.ghi')
            expect(buildRequest(custom, 'abc def')).toMatchObject({ ok: false })
        })

        it('extracts only access_token from a pretty-printed token response', () => {
            const input = JSON.stringify(
                { access_token: ' abc.def ', refresh_token: 'fake-refresh', token_type: 'Bearer' },
                null,
                2,
            )
            const result = buildRequest(custom, `\n${input}\n`)
            expect(result).toMatchObject({ ok: true, request: { customToken: 'abc.def' } })
            expect(JSON.stringify(result)).not.toContain('fake-refresh')
        })

        it('does not echo input or parser messages for malformed JSON', () => {
            const result = buildRequest(custom, '{"access_token": "secret-value-123",')
            const error = JSON.stringify(result)
            expect(result.ok).toBe(false)
            expect(error).not.toContain('secret-value-123')
            expect(error).not.toMatch(/position|Unexpected|JSON\.parse/i)
        })

        it.each([
            ['decoded claims', '{"sub":"123","iss":"https://example.org"}'],
            ['array', '["abc"]'],
            ['string', '"abc"'],
            ['non-string', '{"access_token": 123}'],
            ['empty', '{"access_token": "  "}'],
        ])('rejects %s without an access_token', (_name, input) => {
            const result = buildRequest(custom, input)
            expect(result).toMatchObject({
                ok: false,
                error: expect.stringMatching(/access_token.*signature/),
            })
        })

        it('rejects oversize input before parsing', () => {
            const result = buildRequest(custom, `{"access_token":"${'a'.repeat(MAX_DEBUG_BODY_BYTES)}"}`)
            expect(result).toMatchObject({ ok: false, error: expect.stringContaining('may not exceed') })
        })

        it('rejects an invalid extracted bearer token', () => {
            expect(buildRequest(custom, '{"access_token": "has space"}')).toMatchObject({ ok: false })
        })
    })

    it('emits the custom token only in custom mode', () => {
        expect(buildRequest(draft({ authentication: 'custom' }), 'tok')).toMatchObject({
            ok: true,
            request: { authentication: 'custom', customToken: 'tok' },
        })
        expect(buildRequest(draft({ authentication: 'none' }), 'tok')).toMatchObject({
            ok: true,
            request: { authentication: 'none', customToken: null },
        })
    })

    it('uses the custom method for Other and uppercases it', () => {
        const result = buildRequest(
            draft({ method: 'Other', otherMethod: 'options', resourceType: 'Patient', body: '{}' }),
        )

        expect(result).toMatchObject({
            ok: true,
            request: { method: 'OPTIONS', contentType: 'application/fhir+json' },
        })
    })

    it('rejects whitespace around the Other method instead of trimming it', () => {
        expect(
            buildRequest(draft({ method: 'Other', otherMethod: ' options ', resourceType: 'Patient' })).ok,
        ).toBe(false)
    })

    it('rejects whitespace around resourceType and id instead of trimming them', () => {
        expect(buildRequest(draft({ resourceType: ' Patient ' })).ok).toBe(false)
        expect(buildRequest(draft({ resourceType: 'Patient', id: ' 123 ' })).ok).toBe(false)
    })

    it('removes only one leading question mark and keeps other query bytes', () => {
        expect(buildRequest(draft({ resourceType: 'Patient', query: '??a=b' }))).toMatchObject({
            ok: true,
            request: { query: '?a=b' },
        })
        expect(buildRequest(draft({ resourceType: 'Patient', query: ' a=b ' }))).toMatchObject({
            ok: true,
            request: { query: ' a=b ' },
        })
    })

    it('treats a whitespace-only body as invalid JSON, not as absent', () => {
        const result = buildRequest(draft({ method: 'POST', resourceType: 'Patient', body: '  ' }))

        expect(result.ok).toBe(false)
        expect(!result.ok && result.error).toMatch(/^The body is not valid JSON: /)
    })

    it('requires a method for Other', () => {
        expect(buildRequest(draft({ method: 'Other' }))).toEqual({ ok: false, error: 'Enter a method.' })
    })

    it('reports a malformed JSON body with the parser message', () => {
        const result = buildRequest(draft({ method: 'POST', resourceType: 'Patient', body: '{"a":' }))

        expect(result.ok).toBe(false)
        expect(!result.ok && result.error).toMatch(/^The body is not valid JSON: /)
    })

    it('rejects a body over 1 MB measured in UTF-8 bytes', () => {
        const body = JSON.stringify({ v: 'é'.repeat(MAX_DEBUG_BODY_BYTES / 2) })
        const result = buildRequest(draft({ method: 'POST', resourceType: 'Patient', body }))

        expect(result).toEqual({ ok: false, error: `The body may not exceed ${MAX_DEBUG_BODY_BYTES} bytes.` })
    })

    it('drops the body for GET and the query for POST', () => {
        expect(buildRequest(draft({ resourceType: 'Patient', body: '{}' }))).toMatchObject({
            ok: true,
            request: { body: null, contentType: null },
        })
        expect(
            buildRequest(draft({ method: 'POST', resourceType: 'Patient', query: 'a=b', body: '{}' })),
        ).toMatchObject({ ok: true, request: { query: '' } })
    })

    it('only sends JSON Patch content type for PATCH', () => {
        const contentType = 'application/json-patch+json' as const
        const patch = buildRequest(
            draft({ method: 'PATCH', resourceType: 'Patient', id: '1', body: '[]', contentType }),
        )
        const post = buildRequest(draft({ method: 'POST', resourceType: 'Patient', body: '{}', contentType }))

        expect(patch).toMatchObject({ ok: true, request: { contentType } })
        expect(post).toMatchObject({ ok: true, request: { contentType: 'application/fhir+json' } })
    })

    it('surfaces shared request validation errors', () => {
        const result = buildRequest(draft({ resourceType: 'https://evil.example' }))

        expect(result.ok).toBe(false)
    })
})

describe('method helpers', () => {
    it('classifies methods', () => {
        expect(allowsQuery('GET')).toBe(true)
        expect(allowsQuery('POST')).toBe(false)
        expect(allowsBody('DELETE')).toBe(false)
        expect(allowsBody('PUT')).toBe(true)
        expect(isWrite('HEAD')).toBe(false)
        expect(isWrite('DELETE')).toBe(true)
    })
})
