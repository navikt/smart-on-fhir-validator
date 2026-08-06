import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient } from '#core/http/smart-http-client'

import {
    classifyFhirVersion,
    detectFhirVersion,
    fetchCapabilityStatement,
    isR4,
} from './capability-statement'
import { isSmartError } from './types'

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        return handler(url, init)
    }) as typeof fetch
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/fhir+json' },
        ...init,
    })
}

function clientReturning(response: Response | (() => Response | Promise<Response>)): SmartHttpClient {
    return new SmartHttpClient({
        recorder: createExchangeRecorder(),
        fetchImpl: stubFetch(typeof response === 'function' ? response : () => response),
    })
}

describe('fetchCapabilityStatement', () => {
    it('fetches /metadata with the fhir+json accept header, recorded under the capability phase', async () => {
        const client = clientReturning(
            jsonResponse({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1' }),
        )

        const result = await fetchCapabilityStatement(client, 'https://ehr.example.com/fhir')
        if (isSmartError(result)) throw new Error('expected success')

        expect(result.exchange.phase).toBe('capability')
        expect(result.exchange.request.url).toBe('https://ehr.example.com/fhir/metadata')
        expect(result.exchange.request.headers['accept']).toBe('application/fhir+json')
        expect(result.capabilityStatement).toEqual({
            resourceType: 'CapabilityStatement',
            fhirVersion: '4.0.1',
        })
    })

    it('strips a trailing slash from the FHIR base URL before appending /metadata', async () => {
        const client = clientReturning(jsonResponse({ resourceType: 'CapabilityStatement' }))

        const result = await fetchCapabilityStatement(client, 'https://ehr.example.com/fhir/')
        if (isSmartError(result)) throw new Error('expected success')

        expect(result.exchange.request.url).toBe('https://ehr.example.com/fhir/metadata')
    })

    it('returns a SmartError for a non-2xx status', async () => {
        const client = clientReturning(jsonResponse({ error: 'forbidden' }, { status: 403 }))

        const result = await fetchCapabilityStatement(client, 'https://ehr.example.com/fhir')
        if (!isSmartError(result)) throw new Error('expected an error')

        expect(result.error).toContain('403')
    })

    it('returns a SmartError for a non-JSON body', async () => {
        const client = clientReturning(new Response('not json', { status: 200 }))

        const result = await fetchCapabilityStatement(client, 'https://ehr.example.com/fhir')
        if (!isSmartError(result)) throw new Error('expected an error')

        expect(result.error).toMatch(/JSON/i)
    })

    it('returns a SmartError with detail on transport failure, without throwing', async () => {
        const client = clientReturning(() => {
            throw new Error('connect ECONNREFUSED')
        })

        const result = await fetchCapabilityStatement(client, 'https://ehr.example.com/fhir')
        if (!isSmartError(result)) throw new Error('expected an error')

        expect(result.detail).toBe('connect ECONNREFUSED')
    })
})

describe('detectFhirVersion', () => {
    it('reads fhirVersion from a well-formed CapabilityStatement', () => {
        expect(detectFhirVersion({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1' })).toBe('4.0.1')
    })

    it.each([null, undefined, 'a string', 42, [], { fhirVersion: 123 }, { fhirVersion: '' }])(
        'returns null for hostile input %p',
        (input) => {
            expect(detectFhirVersion(input)).toBeNull()
        },
    )
})

describe('classifyFhirVersion', () => {
    it.each([
        ['4.0.0', 'R4'],
        ['4.0.1', 'R4'],
        ['4.3.0', 'R4B'],
        ['5.0.0', 'R5'],
        ['3.0.1', 'STU3'],
        ['3.0.2', 'STU3'],
        ['1.0.2', 'DSTU2'],
        ['2.9.9', 'unknown'],
        ['not-a-version', 'unknown'],
    ])('classifies %s as %s', (version, expected) => {
        expect(classifyFhirVersion(version)).toBe(expected)
    })

    it('classifies null as unknown', () => {
        expect(classifyFhirVersion(null)).toBe('unknown')
    })
})

describe('isR4', () => {
    it.each([
        ['4.0.0', true],
        ['4.0.1', true],
        ['4.3.0', false],
        ['3.0.2', false],
        [null, false],
    ])('treats %s as R4: %s', (version, expected) => {
        expect(isR4(version)).toBe(expected)
    })
})
