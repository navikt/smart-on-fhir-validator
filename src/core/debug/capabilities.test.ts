import { describe, expect, it } from 'vitest'

import { summarizeCapabilityStatement } from './capabilities'

describe('summarizeCapabilityStatement', () => {
    it('summarizes, dedupes and sorts resources', () => {
        const summary = summarizeCapabilityStatement({
            resourceType: 'CapabilityStatement',
            fhirVersion: '4.0.1',
            rest: [
                {
                    resource: [
                        {
                            type: 'Patient',
                            interaction: [{ code: 'search-type' }, { code: 'read' }, { code: 'read' }],
                            searchParam: [
                                { name: 'name', type: 'string' },
                                { name: '_id', type: 'token' },
                            ],
                            operation: [{ name: 'everything', definition: 'x' }],
                        },
                        { type: 'Observation', interaction: [{ code: 'read' }] },
                    ],
                },
                {
                    resource: [
                        {
                            type: 'Patient',
                            interaction: [{ code: 'create' }],
                            searchParam: [{ name: 'name' }],
                        },
                    ],
                },
            ],
        })

        expect(summary).toEqual({
            fhirVersion: '4.0.1',
            resources: [
                { type: 'Observation', interactions: ['read'], searchParams: [], operations: [] },
                {
                    type: 'Patient',
                    interactions: ['create', 'read', 'search-type'],
                    searchParams: [
                        { name: '_id', type: 'token' },
                        { name: 'name', type: 'string' },
                    ],
                    operations: ['everything'],
                },
            ],
        })
    })

    it('skips malformed entries and tolerates missing fields', () => {
        const summary = summarizeCapabilityStatement({
            fhirVersion: 4,
            rest: [
                null,
                { resource: 'nope' },
                {
                    resource: [
                        null,
                        { interaction: [{ code: 'read' }] },
                        { type: 42 },
                        {
                            type: 'Encounter',
                            interaction: [{ code: 7 }, 'x'],
                            searchParam: [{ type: 'token' }, { name: 'date', type: 3 }],
                        },
                    ],
                },
            ],
        })

        expect(summary).toEqual({
            fhirVersion: null,
            resources: [
                {
                    type: 'Encounter',
                    interactions: [],
                    searchParams: [{ name: 'date', type: null }],
                    operations: [],
                },
            ],
        })
    })

    it.each([null, 'text', 5, [], {}])('returns an empty summary for %j', (input) => {
        expect(summarizeCapabilityStatement(input).resources).toEqual([])
    })
})
