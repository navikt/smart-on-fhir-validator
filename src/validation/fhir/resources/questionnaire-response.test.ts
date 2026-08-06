import type { QuestionnaireResponse } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import type { Validation } from '#validation/validation'

import { validateQuestionnaireResponse } from './questionnaire-response'

function bad(validations: Validation[]): Validation[] {
    return validations.filter((v) => v.severity !== 'OK' && v.severity !== 'INFO')
}

const validQuestionnaireResponse: QuestionnaireResponse = {
    resourceType: 'QuestionnaireResponse',
    id: 'sykmelding-1',
    questionnaire: 'https://www.nav.no/samarbeidspartner/sykmelding/fhir/R4/Questionnaire/V1',
    status: 'completed',
    subject: { reference: 'Patient/patient-1' },
    encounter: { reference: 'Encounter/encounter-1' },
    authored: '2026-02-10T09:30:00+01:00',
    author: { reference: 'Practitioner/practitioner-1' },
    item: [
        {
            linkId: 'hoveddiagnose',
            answer: [
                {
                    valueCoding: {
                        system: 'urn:oid:2.16.578.1.12.4.1.1.7110',
                        code: 'M54.5',
                        display: 'Korsryggsmerter',
                    },
                },
            ],
        },
        {
            linkId: 'aktivitet',
            item: [
                { linkId: 'aktivitet-type', answer: [{ valueCoding: { code: 'AKTIVITET_IKKE_MULIG' } }] },
                { linkId: 'aktivitet-fom', answer: [{ valueDate: '2026-02-10' }] },
                { linkId: 'aktivitet-tom', answer: [{ valueDate: '2026-02-24' }] },
            ],
        },
        { linkId: 'svangerskapsrelatert', answer: [{ valueBoolean: false }] },
    ],
}

const expectations = {
    id: 'sykmelding-1',
    patientId: 'patient-1',
    encounterId: 'encounter-1',
    practitionerId: 'practitioner-1',
}

describe('validateQuestionnaireResponse', () => {
    it('has no bad findings for a fully valid resource', () => {
        expect(bad(validateQuestionnaireResponse(validQuestionnaireResponse))).toEqual([])
    })

    it('has no bad findings and reports OKs when expectations match', () => {
        const result = validateQuestionnaireResponse(validQuestionnaireResponse, expectations)
        expect(bad(result)).toEqual([])
        expect(result.some((v) => v.severity === 'OK')).toBe(true)
    })

    it('errors when the resource is null', () => {
        const result = validateQuestionnaireResponse(null)
        expect(result).toHaveLength(1)
        expect(result[0]?.severity).toBe('ERROR')
    })

    it('errors when resourceType is not QuestionnaireResponse', () => {
        const result = bad(
            validateQuestionnaireResponse({ ...validQuestionnaireResponse, resourceType: 'Bundle' } as never),
        )
        expect(result.some((v) => v.message.includes('is not of type QuestionnaireResponse'))).toBe(true)
    })

    it('errors when id does not match the sykmelding id', () => {
        const result = bad(validateQuestionnaireResponse(validQuestionnaireResponse, { id: 'other-id' }))
        expect(result.some((v) => v.message.includes('was not the same as the id the probe wrote'))).toBe(
            true,
        )
    })

    it('errors when status is not completed', () => {
        const result = bad(
            validateQuestionnaireResponse({ ...validQuestionnaireResponse, status: 'in-progress' }),
        )
        expect(result.some((v) => v.message.includes('must be "completed"'))).toBe(true)
    })

    it('errors when questionnaire is missing', () => {
        const { questionnaire: _questionnaire, ...withoutQuestionnaire } = validQuestionnaireResponse
        const result = bad(validateQuestionnaireResponse(withoutQuestionnaire as QuestionnaireResponse))
        expect(result.some((v) => v.message.includes('questionnaire is missing'))).toBe(true)
    })

    it('errors when questionnaire is not the canonical Nav URL', () => {
        const result = bad(
            validateQuestionnaireResponse({
                ...validQuestionnaireResponse,
                questionnaire: 'https://example.com/other',
            }),
        )
        expect(result.some((v) => v.message.includes('must be "https://www.nav.no'))).toBe(true)
    })

    it('errors when subject is missing', () => {
        const { subject: _subject, ...withoutSubject } = validQuestionnaireResponse
        const result = bad(validateQuestionnaireResponse(withoutSubject as QuestionnaireResponse))
        expect(result.some((v) => v.message.includes('subject is missing'))).toBe(true)
    })

    it('errors when subject does not reference the launch-context patient', () => {
        const result = bad(validateQuestionnaireResponse(validQuestionnaireResponse, { patientId: 'other' }))
        expect(result.some((v) => v.message.includes('does not reference the launch-context Patient'))).toBe(
            true,
        )
    })

    it('errors when encounter is missing', () => {
        const { encounter: _encounter, ...withoutEncounter } = validQuestionnaireResponse
        const result = bad(validateQuestionnaireResponse(withoutEncounter as QuestionnaireResponse))
        expect(result.some((v) => v.message.includes('encounter is missing'))).toBe(true)
    })

    it('errors when author is missing', () => {
        const { author: _author, ...withoutAuthor } = validQuestionnaireResponse
        const result = bad(validateQuestionnaireResponse(withoutAuthor as QuestionnaireResponse))
        expect(result.some((v) => v.message.includes('author is missing'))).toBe(true)
    })

    it('warns when authored is missing', () => {
        const { authored: _authored, ...withoutAuthored } = validQuestionnaireResponse
        const result = validateQuestionnaireResponse(withoutAuthored as QuestionnaireResponse)
        expect(
            result.some((v) => v.severity === 'WARNING' && v.message.includes('authored is missing')),
        ).toBe(true)
    })

    it('errors when an item is missing a linkId', () => {
        const result = bad(
            validateQuestionnaireResponse({
                ...validQuestionnaireResponse,
                item: [{ linkId: '', answer: [{ valueBoolean: true }] }],
            }),
        )
        expect(result.some((v) => v.message.includes('does not contain a linkId'))).toBe(true)
    })

    it('errors when an item has both answer and nested item (HL7 R4: groups cannot have answers)', () => {
        const result = bad(
            validateQuestionnaireResponse({
                ...validQuestionnaireResponse,
                item: [
                    {
                        linkId: 'aktivitet',
                        answer: [{ valueBoolean: true }],
                        item: [{ linkId: 'aktivitet-type', answer: [{ valueCoding: { code: 'X' } }] }],
                    },
                ],
            }),
        )
        expect(result.some((v) => v.message.includes('has both "answer" and nested "item"'))).toBe(true)
    })

    it('errors when an answer has no value[x] field', () => {
        const result = bad(
            validateQuestionnaireResponse({
                ...validQuestionnaireResponse,
                item: [{ linkId: 'svangerskapsrelatert', answer: [{}] }],
            }),
        )
        expect(result.some((v) => v.message.includes('has an answer with no value[x] field'))).toBe(true)
    })

    it('validates nested items recursively', () => {
        const result = bad(
            validateQuestionnaireResponse({
                ...validQuestionnaireResponse,
                item: [
                    { linkId: 'aktivitet', item: [{ linkId: '', answer: [{ valueDate: '2026-01-01' }] }] },
                ],
            }),
        )
        expect(
            result.some((v) => v.message.includes('item[0].item[0]') && v.message.includes('linkId')),
        ).toBe(true)
    })
})
