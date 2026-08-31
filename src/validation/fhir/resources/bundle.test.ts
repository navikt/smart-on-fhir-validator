import type { Bundle, DocumentReference, OperationOutcome, QuestionnaireResponse } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import type { Validation } from '#validation/validation'

import { validateBatchBundleRequest, validateBatchBundleResponse } from './bundle'

function bad(validations: Validation[]): Validation[] {
    return validations.filter((v) => v.severity !== 'OK' && v.severity !== 'INFO')
}

const documentReference: DocumentReference = {
    resourceType: 'DocumentReference',
    id: 'sykmelding-1',
    status: 'current',
    content: [{ attachment: { contentType: 'application/pdf', data: 'abc' } }],
    context: { related: [{ reference: 'QuestionnaireResponse/sykmelding-1' }] },
}

const questionnaireResponse: QuestionnaireResponse = {
    resourceType: 'QuestionnaireResponse',
    id: 'sykmelding-1',
    status: 'completed',
}

const validBatchBundle: Bundle = {
    resourceType: 'Bundle',
    type: 'batch',
    entry: [
        {
            fullUrl: 'QuestionnaireResponse/sykmelding-1',
            resource: questionnaireResponse,
            request: { method: 'PUT', url: 'QuestionnaireResponse/sykmelding-1' },
        },
        {
            fullUrl: 'DocumentReference/sykmelding-1',
            resource: documentReference,
            request: { method: 'PUT', url: 'DocumentReference/sykmelding-1' },
        },
    ],
}

describe('validateBatchBundleRequest', () => {
    it('has no bad findings for a valid batch Bundle', () => {
        expect(bad(validateBatchBundleRequest(validBatchBundle))).toEqual([])
    })

    it('errors when Bundle.type is transaction instead of batch', () => {
        const result = bad(validateBatchBundleRequest({ ...validBatchBundle, type: 'transaction' }))
        expect(result.some((v) => v.message.includes('must be "batch"'))).toBe(true)
        expect(result.some((v) => v.message.includes('journalføringsplikten'))).toBe(true)
    })

    it('errors when an entry is missing a request', () => {
        const bundle: Bundle = {
            ...validBatchBundle,
            entry: [{ resource: documentReference }],
        }
        const result = bad(validateBatchBundleRequest(bundle))
        expect(result.some((v) => v.message.includes('does not contain a request object'))).toBe(true)
    })

    it('errors when an entry uses POST instead of PUT', () => {
        const bundle: Bundle = {
            ...validBatchBundle,
            entry: [
                {
                    resource: documentReference,
                    request: { method: 'POST', url: 'DocumentReference' },
                },
            ],
        }
        const result = bad(validateBatchBundleRequest(bundle))
        expect(result.some((v) => v.message.includes('should be "PUT"'))).toBe(true)
    })

    it('errors when Bundle has no entries', () => {
        const result = bad(validateBatchBundleRequest({ ...validBatchBundle, entry: [] }))
        expect(result.some((v) => v.message.includes('does not contain any entries'))).toBe(true)
    })

    it('errors when an internal urn:uuid reference does not resolve to a fullUrl', () => {
        const unresolvedReference: DocumentReference = {
            ...documentReference,
            context: { related: [{ reference: 'urn:uuid:unknown' }] },
        }
        const bundle: Bundle = {
            resourceType: 'Bundle',
            type: 'batch',
            entry: [
                {
                    fullUrl: 'urn:uuid:known',
                    resource: unresolvedReference,
                    request: { method: 'PUT', url: 'DocumentReference/sykmelding-1' },
                },
            ],
        }
        const result = bad(validateBatchBundleRequest(bundle))
        expect(result.some((v) => v.message.includes('do not resolve to any entry.fullUrl'))).toBe(true)
    })
})

describe('validateBatchBundleResponse', () => {
    it('has no bad findings for a well-formed batch-response with all entries succeeding', () => {
        const response: Bundle = {
            resourceType: 'Bundle',
            type: 'batch-response',
            entry: [{ response: { status: '200 OK' } }, { response: { status: '201 Created' } }],
        }
        expect(bad(validateBatchBundleResponse(response, 2))).toEqual([])
    })

    it('errors when the response is null', () => {
        const result = bad(validateBatchBundleResponse(null, 2))
        expect(result.some((v) => v.message.includes('did not return a Bundle'))).toBe(true)
    })

    it('errors when the response Bundle.type is searchset instead of batch-response', () => {
        const response: Bundle = { resourceType: 'Bundle', type: 'searchset', entry: [] }
        const result = bad(validateBatchBundleResponse(response, 2))
        expect(
            result.some(
                (v) =>
                    v.message.includes('had type "searchset"') &&
                    v.message.includes('must return a Bundle of type "batch-response"'),
            ),
        ).toBe(true)
    })

    it('errors when the entry count does not match the request', () => {
        const response: Bundle = {
            resourceType: 'Bundle',
            type: 'batch-response',
            entry: [{ response: { status: '200 OK' } }],
        }
        const result = bad(validateBatchBundleResponse(response, 2))
        expect(result.some((v) => v.message.includes('contains 1 entries, expected exactly 2'))).toBe(true)
    })

    it('surfaces a failed entry individually without failing the whole batch (partial failure)', () => {
        const failureOutcome: OperationOutcome = {
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Bad questionnaire item' }],
        }
        const response: Bundle = {
            resourceType: 'Bundle',
            type: 'batch-response',
            entry: [
                { response: { status: '200 OK' } },
                {
                    response: {
                        status: '422 Unprocessable Entity',
                        outcome: failureOutcome,
                    },
                },
                { response: { status: '201 Created' } },
            ],
        }
        const result = validateBatchBundleResponse(response, 3)

        const entrySuccesses = result.filter((v) => v.message.includes('succeeded with status'))
        expect(entrySuccesses).toHaveLength(2)

        const entryFailure = result.find((v) => v.message.includes('failed with status "422'))
        expect(entryFailure?.severity).toBe('WARNING')
        expect(entryFailure?.message).toContain('Bad questionnaire item')
        expect(entryFailure?.message).toContain('does not affect the other entries')
    })
})
