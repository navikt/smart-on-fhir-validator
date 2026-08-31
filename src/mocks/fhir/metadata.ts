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

// The R4 `fhirVersion` type enumerates only releases up to 4.0.1, but the `fhir-version-r4b` and
// `fhir-version-r5` defects deliberately advertise a newer release so the validator can be tested
// against a server whose FHIR version does not match R4. The cast is what makes that possible.
function fhirVersion(state: MockState): CapabilityStatement['fhirVersion'] {
    if (state.defects.has('fhir-version-r4b')) return '4.3.0' as CapabilityStatement['fhirVersion']
    if (state.defects.has('fhir-version-r5')) return '5.0.0' as CapabilityStatement['fhirVersion']

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
