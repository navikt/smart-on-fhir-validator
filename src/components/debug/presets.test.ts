import { describe, expect, it } from 'vitest'

import { buildRequest } from './draft'
import {
    examplePresets,
    launchShortcuts,
    parseFhirUserReference,
    sidebarDraft,
    type LaunchContext,
} from './presets'

const full: LaunchContext = { patient: 'p1', encounter: 'e1', fhirUser: 'Practitioner/pr1' }
const empty: LaunchContext = { patient: null, encounter: null, fhirUser: null }

describe('parseFhirUserReference', () => {
    it('accepts a relative ResourceType/id', () => {
        expect(parseFhirUserReference('Practitioner/abc-1.2')).toEqual({
            resourceType: 'Practitioner',
            id: 'abc-1.2',
        })
    })

    it.each([
        'https://ehr.example.com/fhir/Practitioner/1',
        '//host/Practitioner/1',
        'Practitioner/../x',
        'Practitioner/..',
        'Practitioner/1/_history',
        'Practitioner/a?b=c',
        'practitioner/1',
        'Practitioner',
        '',
        null,
    ])('ignores %s', (value) => {
        expect(parseFhirUserReference(value)).toBeNull()
    })
})

describe('launchShortcuts', () => {
    it('builds read and search shortcuts from the launch context', () => {
        const shortcuts = launchShortcuts(full)

        expect(shortcuts.map((shortcut) => shortcut.label)).toEqual([
            'Patient/p1',
            'Encounter/e1',
            'Practitioner/pr1',
            'Condition?patient=p1',
            'Observation?patient=p1&_sort=-date',
        ])
        expect(shortcuts.at(-1)?.draft).toMatchObject({
            method: 'GET',
            resourceType: 'Observation',
            id: '',
            query: 'patient=p1&_sort=-date',
        })
        for (const shortcut of shortcuts) expect(buildRequest(shortcut.draft).ok).toBe(true)
    })

    it('offers nothing without launch context and skips unsafe ids', () => {
        expect(launchShortcuts(empty)).toEqual([])
        expect(
            launchShortcuts({ patient: 'a/b', encounter: '..', fhirUser: 'https://x/Practitioner/1' }),
        ).toEqual([])
    })
})

describe('examplePresets', () => {
    it('provides five valid drafts that use the launch patient', () => {
        const examples = examplePresets(full)

        expect(examples).toHaveLength(5)
        for (const example of examples) {
            expect(example.disabledReason).toBeNull()
            expect(buildRequest(example.draft).ok).toBe(true)
        }

        const post = examples.find((example) => example.key === 'create-document-reference')
        expect(post?.draft.method).toBe('POST')
        expect(JSON.parse(post?.draft.body ?? '{}')).toMatchObject({
            resourceType: 'DocumentReference',
            status: 'current',
            subject: { reference: 'Patient/p1' },
        })
        expect(examples.find((example) => example.key === 'not-found')?.draft).toMatchObject({
            resourceType: 'Patient',
            id: 'does-not-exist',
        })
    })

    it('disables only the patient-specific examples when the launch has no patient', () => {
        const disabled = examplePresets(empty)
            .filter((example) => example.disabledReason !== null)
            .map((example) => example.key)

        expect(disabled).toEqual(['read-patient', 'search-conditions', 'create-document-reference'])
    })
})

const resource = (type: string, names: string[], interactions = ['read', 'search-type']) => ({
    type,
    interactions,
    searchParams: names.map((name) => ({ name, type: null })),
    operations: [],
})

describe('advertised patient search parameter', () => {
    const subjectOnly = [resource('Condition', ['subject', 'encounter'])]

    it('uses subject for conditions when only subject is advertised', () => {
        const shortcut = launchShortcuts(full, subjectOnly).find((item) => item.key === 'conditions')
        const example = examplePresets(full, subjectOnly).find((item) => item.key === 'search-conditions')

        expect(shortcut?.label).toBe('Condition?subject=Patient/p1')
        for (const draft of [shortcut?.draft, example?.draft]) {
            expect(draft?.query).toBe('subject=Patient/p1')
            expect(draft && buildRequest(draft).ok).toBe(true)
        }
    })

    it('applies the same selection to observations and keeps the sort', () => {
        const shortcuts = launchShortcuts(full, [resource('Observation', ['subject', 'code'])])

        expect(shortcuts.at(-1)?.label).toBe('Observation?subject=Patient/p1&_sort=-date')
        expect(shortcuts.at(-1)?.draft.query).toBe('subject=Patient/p1&_sort=-date')
    })

    it('prefers patient when both are advertised', () => {
        const both = [resource('Condition', ['subject', 'patient'])]

        expect(launchShortcuts(full, both).find((item) => item.key === 'conditions')?.draft.query).toBe(
            'patient=p1',
        )
        expect(examplePresets(full, both).find((item) => item.key === 'search-conditions')?.draft.query).toBe(
            'patient=p1',
        )
    })

    it.each([
        ['no capabilities', undefined],
        ['an unlisted resource', [resource('Encounter', ['subject'])]],
        ['no search parameters', [resource('Condition', [])]],
    ])('falls back to patient with %s', (_name, resources) => {
        expect(launchShortcuts(full, resources).find((item) => item.key === 'conditions')?.draft.query).toBe(
            'patient=p1',
        )
        expect(
            examplePresets(full, resources).find((item) => item.key === 'search-conditions')?.draft.query,
        ).toBe('patient=p1')
    })
})

describe('sidebarDraft', () => {
    it('uses the launch patient for a patient search parameter', () => {
        expect(sidebarDraft(resource('Condition', ['patient', 'code']), full)).toMatchObject({
            method: 'GET',
            resourceType: 'Condition',
            id: '',
            query: 'patient=p1',
        })
    })

    it('uses Patient/{id} for a subject parameter', () => {
        expect(sidebarDraft(resource('Observation', ['subject']), full).query).toBe('subject=Patient/p1')
    })

    it('falls back to name=example for Patient and to the first plain parameter otherwise', () => {
        expect(sidebarDraft(resource('Patient', ['name', 'birthdate']), empty).query).toBe('name=example')
        expect(sidebarDraft(resource('Organization', ['name']), empty).query).toBe('name=example')
        expect(sidebarDraft(resource('Location', ['status']), empty).query).toBe('status=example')
    })

    it('keeps the generic fallback when neither patient nor subject is listed', () => {
        expect(sidebarDraft(resource('Condition', ['code']), full).query).toBe('code=example')
    })

    it('leaves the query empty when the type cannot be searched', () => {
        expect(sidebarDraft(resource('Binary', ['name'], ['read']), full).query).toBe('')
    })
})
