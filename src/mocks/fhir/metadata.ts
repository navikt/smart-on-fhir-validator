import type { CapabilityStatement } from 'fhir/r4'

import type { MockState } from '#mocks/state'

const RESOURCES = [
    'Patient',
    'Practitioner',
    'PractitionerRole',
    'Organization',
    'Encounter',
    'Condition',
    'DocumentReference',
    'Binary',
    'QuestionnaireResponse',
] as const

function fhirVersion(state: MockState): string {
    if (state.defects.has('fhir-version-r4b')) return '4.3.0'
    if (state.defects.has('fhir-version-r5')) return '5.0.0'

    return '4.0.1'
}

export function buildCapabilityStatement(state: MockState): CapabilityStatement {
    return {
        resourceType: 'CapabilityStatement',
        status: 'active',
        date: new Date().toISOString(),
        kind: 'instance',
        fhirVersion: fhirVersion(state),
        format: ['json'],
        rest: [
            {
                mode: 'server',
                security: {
                    service: [
                        {
                            coding: [
                                {
                                    system: 'http://terminology.hl7.org/CodeSystem/restful-security-service',
                                    code: 'SMART-on-FHIR',
                                },
                            ],
                        },
                    ],
                    extension: [
                        {
                            url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
                            extension: [
                                { url: 'authorize', valueUri: `${state.baseUrl}/authorize` },
                                { url: 'token', valueUri: `${state.baseUrl}/token` },
                                { url: 'register', valueUri: `${state.baseUrl}/register` },
                            ],
                        },
                    ],
                },
                resource: RESOURCES.map((type) => ({
                    type,
                    interaction: [{ code: 'read' }, { code: 'search-type' }],
                })),
            },
        ],
    }
}
