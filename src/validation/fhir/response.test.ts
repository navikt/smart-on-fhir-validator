import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'

import {
    capSeverity,
    grantsFhirAccess,
    interpretRead,
    interpretSearch,
    isOperationOutcome,
    operationOutcomeFindings,
} from './response'

/** Builds an injectable `fetch` stub so tests never touch the network. */
function stubFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
    return (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        return handler(url)
    }) as typeof fetch
}

function fhirJson(body: unknown, status = 200, contentType = 'application/fhir+json'): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } })
}

async function get(response: Response) {
    const recorder = createExchangeRecorder()
    const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => response) })

    return client.get('fhir-read', 'https://ehr.example.com/fhir/Patient/123')
}

describe('grantsFhirAccess', () => {
    it('matches a v2 CRUDS scope for read and search', () => {
        expect(grantsFhirAccess(['patient/Condition.rs'], 'Condition', 'read')).toBe(true)
        expect(grantsFhirAccess(['patient/Condition.rs'], 'Condition', 'search')).toBe(true)
    })

    it('matches a v1 read scope for both interactions', () => {
        expect(grantsFhirAccess(['patient/Condition.read'], 'Condition', 'read')).toBe(true)
        expect(grantsFhirAccess(['patient/Condition.read'], 'Condition', 'search')).toBe(true)
    })

    it('does not match a scope for a different resource', () => {
        expect(grantsFhirAccess(['patient/Patient.rs'], 'Condition', 'read')).toBe(false)
    })

    it('matches a wildcard resource scope', () => {
        expect(grantsFhirAccess(['patient/*.rs'], 'Condition', 'read')).toBe(true)
    })

    it('does not match a write-only v2 scope for read', () => {
        expect(grantsFhirAccess(['patient/Condition.cud'], 'Condition', 'read')).toBe(false)
    })
})

describe('capSeverity', () => {
    it('clamps severities above the maximum, leaving others untouched', () => {
        const results = capSeverity(
            [
                { message: 'a', severity: 'ERROR' },
                { message: 'b', severity: 'OK' },
                { message: 'c', severity: 'WARNING' },
            ],
            'WARNING',
        )

        expect(results.map((r) => r.severity)).toEqual(['WARNING', 'OK', 'WARNING'])
    })
})

describe('isOperationOutcome', () => {
    it('recognizes an OperationOutcome body', () => {
        expect(isOperationOutcome({ resourceType: 'OperationOutcome', issue: [] })).toBe(true)
    })

    it('rejects other shapes', () => {
        expect(isOperationOutcome({ resourceType: 'Patient' })).toBe(false)
        expect(isOperationOutcome(null)).toBe(false)
        expect(isOperationOutcome('text')).toBe(false)
    })
})

describe('operationOutcomeFindings', () => {
    it('extracts severity, code and diagnostics into an actionable message', () => {
        const findings = operationOutcomeFindings(
            {
                resourceType: 'OperationOutcome',
                issue: [{ severity: 'error', code: 'forbidden', diagnostics: 'scope missing' }],
            },
            'https://ehr.example.com/fhir/Condition?subject=Patient/123',
        )

        expect(findings).toHaveLength(1)
        expect(findings[0]?.severity).toBe('ERROR')
        expect(findings[0]?.message).toContain('forbidden')
        expect(findings[0]?.message).toContain('scope missing')
    })

    it('maps warning/information issue severities correctly', () => {
        const findings = operationOutcomeFindings(
            {
                resourceType: 'OperationOutcome',
                issue: [
                    { severity: 'warning', code: 'processing', diagnostics: 'w' },
                    { severity: 'information', code: 'informational', diagnostics: 'i' },
                ],
            },
            'https://ehr.example.com/fhir/Patient/123',
        )

        expect(findings[0]?.severity).toBe('WARNING')
        expect(findings[1]?.severity).toBe('INFO')
    })

    it('flags an OperationOutcome with no issues as malformed', () => {
        const findings = operationOutcomeFindings(
            { resourceType: 'OperationOutcome', issue: [] },
            'https://ehr.example.com/fhir/Patient/123',
        )

        expect(findings).toHaveLength(1)
        expect(findings[0]?.severity).toBe('ERROR')
    })
})

describe('interpretRead', () => {
    it('returns the resource and OK findings for a conformant 200 application/fhir+json read', async () => {
        const response = await get(fhirJson({ resourceType: 'Patient', id: '123' }))

        const result = interpretRead<{ resourceType: 'Patient'; id: string }>(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: ['patient/Patient.rs'],
        })

        expect(result.resource).toEqual({ resourceType: 'Patient', id: '123' })
        expect(result.validations.every((v) => v.severity === 'OK')).toBe(true)
        expect(result.validations.length).toBeGreaterThanOrEqual(2)
    })

    it('warns on a bare application/json content type', async () => {
        const response = await get(fhirJson({ resourceType: 'Patient', id: '123' }, 200, 'application/json'))

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.validations.some((v) => v.severity === 'WARNING')).toBe(true)
        expect(result.resource).not.toBeNull()
    })

    it('errors on an unrelated content type', async () => {
        const response = await get(fhirJson({ resourceType: 'Patient', id: '123' }, 200, 'text/html'))

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.validations.some((v) => v.severity === 'ERROR')).toBe(true)
    })

    it('errors when the status is not 200', async () => {
        const response = await get(fhirJson({ resourceType: 'Patient', id: '123' }, 500))

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.validations.some((v) => v.severity === 'ERROR' && v.message.includes('500'))).toBe(true)
        expect(result.resource).not.toBeNull()
    })

    it('reports 401 as an ERROR mentioning the bearer token', async () => {
        const response = await get(fhirJson({ resourceType: 'OperationOutcome', issue: [] }, 401))

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.validations.some((v) => v.severity === 'ERROR' && v.message.includes('401'))).toBe(true)
        expect(result.resource).toBeNull()
    })

    it('reports 403 and names the missing scope when granted scopes do not cover the resource', async () => {
        const response = await get(
            fhirJson(
                { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] },
                403,
            ),
        )

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: ['patient/Patient.rs'],
        })

        const forbidden = result.validations.find((v) => v.message.includes('403'))
        expect(forbidden?.severity).toBe('ERROR')
        expect(forbidden?.message).toContain('did not include')
        expect(forbidden?.message).toContain('Condition')
    })

    it('surfaces an OperationOutcome instead of reporting a shape mismatch', async () => {
        const response = await get(
            fhirJson(
                {
                    resourceType: 'OperationOutcome',
                    issue: [
                        { severity: 'error', code: 'not-found', diagnostics: 'Patient/123 does not exist' },
                    ],
                },
                404,
            ),
        )

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.resource).toBeNull()
        expect(result.validations.some((v) => v.message.includes('Patient/123 does not exist'))).toBe(true)
        expect(result.validations.some((v) => v.message.includes('did not return a Patient resource'))).toBe(
            false,
        )
    })

    it('reports a shape mismatch when the body is not the expected resource', async () => {
        const response = await get(fhirJson({ resourceType: 'Organization', id: '123' }))

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.resource).toBeNull()
        expect(
            result.validations.some((v) => v.severity === 'ERROR' && v.message.includes('Organization')),
        ).toBe(true)
    })

    it('reports a non-JSON body without throwing', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => new Response('<html></html>', { status: 200 })),
        })
        const response = await client.get('fhir-read', 'https://ehr.example.com/fhir/Patient/123')

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.resource).toBeNull()
        expect(result.validations.some((v) => v.severity === 'ERROR')).toBe(true)
    })

    it('handles a transport failure gracefully, without throwing', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => {
                throw new Error('getaddrinfo ENOTFOUND ehr.example.com')
            }),
        })
        const response = await client.get('fhir-read', 'https://ehr.example.com/fhir/Patient/123')

        const result = interpretRead(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
        })

        expect(result.resource).toBeNull()
        expect(result.validations).toHaveLength(1)
        expect(result.validations[0]?.severity).toBe('ERROR')
        expect(result.validations[0]?.message).toContain('transport level')
    })
})

function searchsetBundle(resources: { resourceType: string; id: string }[], total?: number) {
    return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: total ?? resources.length,
        entry: resources.map((resource) => ({ resource, search: { mode: 'match' } })),
    }
}

describe('interpretSearch', () => {
    it('extracts entries and reports total for a conformant searchset', async () => {
        const response = await get(
            fhirJson(
                searchsetBundle([
                    { resourceType: 'Condition', id: 'c1' },
                    { resourceType: 'Condition', id: 'c2' },
                ]),
            ),
        )

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: ['patient/Condition.rs'],
        })

        expect(result.entries).toHaveLength(2)
        expect(result.total).toBe(2)
        expect(result.validations.some((v) => v.message.includes('total 2'))).toBe(true)
    })

    it('warns when a search expected to be unique returns more than one match', async () => {
        const response = await get(
            fhirJson(
                searchsetBundle([
                    { resourceType: 'Patient', id: 'p1' },
                    { resourceType: 'Patient', id: 'p2' },
                ]),
            ),
        )

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: [],
            expectUnique: true,
        })

        expect(result.validations.some((v) => v.severity === 'WARNING' && v.message.includes('single'))).toBe(
            true,
        )
    })

    it('does not warn for a non-unique search with several matches', async () => {
        const response = await get(
            fhirJson(
                searchsetBundle([
                    { resourceType: 'Condition', id: 'c1' },
                    { resourceType: 'Condition', id: 'c2' },
                ]),
            ),
        )

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: [],
        })

        expect(result.validations.some((v) => v.severity === 'WARNING')).toBe(false)
    })

    it('reports an empty searchset without error', async () => {
        const response = await get(fhirJson(searchsetBundle([])))

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: [],
        })

        expect(result.entries).toHaveLength(0)
        expect(result.total).toBe(0)
        expect(result.validations.some((v) => v.severity === 'ERROR')).toBe(false)
    })

    it('errors when the body is a Bundle but not of type searchset', async () => {
        const response = await get(fhirJson({ resourceType: 'Bundle', type: 'collection', entry: [] }))

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: [],
        })

        expect(result.entries).toHaveLength(0)
        expect(
            result.validations.some((v) => v.severity === 'ERROR' && v.message.includes('searchset')),
        ).toBe(true)
    })

    it('errors when the body is not a Bundle at all', async () => {
        const response = await get(fhirJson({ resourceType: 'Condition', id: 'c1' }))

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: [],
        })

        expect(
            result.validations.some((v) => v.severity === 'ERROR' && v.message.includes('searchset')),
        ).toBe(true)
    })

    it('surfaces an OperationOutcome for an unsupported search parameter', async () => {
        const response = await get(
            fhirJson(
                {
                    resourceType: 'OperationOutcome',
                    issue: [
                        {
                            severity: 'error',
                            code: 'not-supported',
                            diagnostics: 'Condition does not support the search parameter(s): category',
                        },
                    ],
                },
                400,
            ),
        )

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: [],
        })

        expect(result.entries).toHaveLength(0)
        expect(result.validations.some((v) => v.message.includes('category'))).toBe(true)
    })

    it('reports 403 for a search naming the resource and scopes', async () => {
        const response = await get(
            fhirJson(
                { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'forbidden' }] },
                403,
            ),
        )

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Encounter',
            grantedScopes: [],
        })

        expect(
            result.validations.some((v) => v.message.includes('403') && v.message.includes('Encounter')),
        ).toBe(true)
    })

    it('handles a transport failure gracefully', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => {
                throw new Error('timeout')
            }),
        })
        const response = await client.get(
            'fhir-read',
            'https://ehr.example.com/fhir/Condition?subject=Patient/1',
        )

        const result = interpretSearch(response, {
            url: response.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: [],
        })

        expect(result.entries).toHaveLength(0)
        expect(result.total).toBeNull()
        expect(result.validations[0]?.message).toContain('transport level')
    })
})
