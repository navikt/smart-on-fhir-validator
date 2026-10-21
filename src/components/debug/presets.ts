import type { CapabilityResource } from '#core/debug/capabilities'

import { EMPTY_DRAFT, type RequestDraft } from './draft'

export type LaunchContext = {
    patient: string | null
    encounter: string | null
    fhirUser: string | null
}

export type Preset = {
    key: string
    label: string
    description: string
    draft: RequestDraft
    disabledReason: string | null
}

const REFERENCE_PATTERN = /^([A-Z][A-Za-z]{0,63})\/([A-Za-z0-9\-.]{1,64})$/
const ID_PATTERN = /^[A-Za-z0-9\-.]{1,64}$/

function isSafeId(value: string | null): value is string {
    return value !== null && ID_PATTERN.test(value) && value !== '.' && value !== '..'
}

export function parseFhirUserReference(fhirUser: string | null): { resourceType: string; id: string } | null {
    const match = fhirUser === null ? null : REFERENCE_PATTERN.exec(fhirUser)
    if (!match) return null

    const [, resourceType = '', id = ''] = match
    return isSafeId(id) ? { resourceType, id } : null
}

const get = (resourceType: string, id = '', query = ''): RequestDraft => ({
    ...EMPTY_DRAFT,
    resourceType,
    id,
    query,
})

function advertisedPatientQuery(resource: CapabilityResource | undefined, patient: string): string | null {
    const names = new Set(resource?.searchParams.map((param) => param.name))
    if (names.has('patient')) return `patient=${patient}`
    if (names.has('subject')) return `subject=Patient/${patient}`
    return null
}

function findResource(
    resources: CapabilityResource[] | undefined,
    type: string,
): CapabilityResource | undefined {
    return resources?.find((resource) => resource.type === type)
}

const MISSING_PATIENT = 'This launch did not return a patient.'

export function launchShortcuts(context: LaunchContext, resources?: CapabilityResource[]): Preset[] {
    const patient = isSafeId(context.patient) ? context.patient : null
    const encounter = isSafeId(context.encounter) ? context.encounter : null
    const fhirUser = parseFhirUserReference(context.fhirUser)
    const shortcuts: Preset[] = []

    if (patient) {
        shortcuts.push({
            key: 'patient',
            label: `Patient/${patient}`,
            description: 'Read the launch patient.',
            draft: get('Patient', patient),
            disabledReason: null,
        })
    }
    if (encounter) {
        shortcuts.push({
            key: 'encounter',
            label: `Encounter/${encounter}`,
            description: 'Read the launch encounter.',
            draft: get('Encounter', encounter),
            disabledReason: null,
        })
    }
    if (fhirUser) {
        shortcuts.push({
            key: 'fhir-user',
            label: `${fhirUser.resourceType}/${fhirUser.id}`,
            description: 'Read the signed-in user.',
            draft: get(fhirUser.resourceType, fhirUser.id),
            disabledReason: null,
        })
    }
    if (patient) {
        const conditionQuery =
            advertisedPatientQuery(findResource(resources, 'Condition'), patient) ?? `patient=${patient}`
        const observationQuery = `${
            advertisedPatientQuery(findResource(resources, 'Observation'), patient) ?? `patient=${patient}`
        }&_sort=-date`
        shortcuts.push(
            {
                key: 'conditions',
                label: `Condition?${conditionQuery}`,
                description: 'Search the launch patient\u2019s conditions.',
                draft: get('Condition', '', conditionQuery),
                disabledReason: null,
            },
            {
                key: 'observations',
                label: `Observation?${observationQuery}`,
                description: 'Search the launch patient\u2019s observations, newest first.',
                draft: get('Observation', '', observationQuery),
                disabledReason: null,
            },
        )
    }

    return shortcuts
}

export function examplePresets(context: LaunchContext, resources?: CapabilityResource[]): Preset[] {
    const patient = isSafeId(context.patient) ? context.patient : null
    const disabledReason = patient ? null : MISSING_PATIENT
    const patientId = patient ?? ''
    const conditionQuery =
        advertisedPatientQuery(findResource(resources, 'Condition'), patientId) ?? `patient=${patientId}`

    const documentReference = {
        resourceType: 'DocumentReference',
        status: 'current',
        subject: { reference: `Patient/${patientId}` },
        content: [{ attachment: { contentType: 'text/plain', data: 'SGVsbG8gZnJvbSBEZWJ1ZyBtb2Rl' } }],
    }

    return [
        {
            key: 'read-patient',
            label: 'Read the launch patient',
            description: 'A read by id returns one resource, here the patient from the launch.',
            draft: get('Patient', patientId),
            disabledReason,
        },
        {
            key: 'search-conditions',
            label: 'Search conditions',
            description: 'A search returns a Bundle, here the conditions that reference the patient.',
            draft: get('Condition', '', conditionQuery),
            disabledReason,
        },
        {
            key: 'create-document-reference',
            label: 'Create a DocumentReference',
            description: 'A POST creates a resource. This writes to the connected server.',
            draft: {
                ...EMPTY_DRAFT,
                method: 'POST',
                resourceType: 'DocumentReference',
                body: JSON.stringify(documentReference, null, 2),
            },
            disabledReason,
        },
        {
            key: 'metadata',
            label: 'Read the CapabilityStatement',
            description: 'The metadata endpoint lists what the server says it supports.',
            draft: get('metadata'),
            disabledReason: null,
        },
        {
            key: 'not-found',
            label: 'Read a missing patient',
            description: 'This fails on purpose and returns an OperationOutcome that explains why.',
            draft: get('Patient', 'does-not-exist'),
            disabledReason: null,
        },
    ]
}

const PREFERRED_FALLBACKS = ['name', 'identifier', '_id']

export function sidebarDraft(resource: CapabilityResource, context: LaunchContext): RequestDraft {
    const patient = isSafeId(context.patient) ? context.patient : null
    const names = new Set(resource.searchParams.map((param) => param.name))
    const patientQuery = patient ? advertisedPatientQuery(resource, patient) : null
    const canSearch = resource.interactions.includes('search-type')

    let query = ''
    if (canSearch) {
        if (resource.type === 'Patient') {
            query = names.has('name') ? 'name=example' : ''
        } else if (patientQuery) {
            query = patientQuery
        } else {
            const fallback =
                PREFERRED_FALLBACKS.find((name) => names.has(name)) ??
                resource.searchParams.find((param) => param.type !== 'reference')?.name
            query = fallback ? `${fallback}=example` : ''
        }
    }

    return get(resource.type, '', query)
}
