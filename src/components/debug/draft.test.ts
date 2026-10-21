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
            },
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
