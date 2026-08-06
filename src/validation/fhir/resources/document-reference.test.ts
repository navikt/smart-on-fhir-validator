import type { DocumentReference } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import type { Validation } from '#validation/validation'

import { validateDocumentReference } from './document-reference'

function isBad(validation: Validation): boolean {
    return validation.severity !== 'OK' && validation.severity !== 'INFO'
}

function bad(validations: Validation[]): Validation[] {
    return validations.filter(isBad)
}

const validDocumentReference: DocumentReference = {
    resourceType: 'DocumentReference',
    id: 'sykmelding-123',
    description: '100% Sykmelding fra 01.06.2024 til 07.06.2024',
    date: '2026-02-10T09:30:00+01:00',
    content: [
        {
            attachment: {
                title: 'Sykmelding',
                language: 'NO-nb',
                contentType: 'application/pdf',
                data: 'YmFzZTY0LXBkZg==',
            },
        },
    ],
    type: {
        coding: [
            {
                system: 'urn:oid:2.16.578.1.12.4.1.1.9602',
                code: 'J01-2',
                display: 'Sykmeldinger og trygdesaker',
            },
        ],
    },
    subject: { reference: 'Patient/patient-1' },
    author: [{ reference: 'Practitioner/practitioner-1' }],
    context: {
        encounter: [{ reference: 'Encounter/encounter-1' }],
    },
    status: 'current',
}

const expectations = {
    id: 'sykmelding-123',
    patientId: 'patient-1',
    encounterId: 'encounter-1',
    practitionerId: 'practitioner-1',
}

describe('validateDocumentReference', () => {
    it('has no bad findings for a fully valid resource with no expectations', () => {
        expect(bad(validateDocumentReference(validDocumentReference))).toEqual([])
    })

    it('has no bad findings for a fully valid resource with matching expectations, and reports OKs', () => {
        const result = validateDocumentReference(validDocumentReference, expectations)
        expect(bad(result)).toEqual([])
        expect(result.some((v) => v.severity === 'OK')).toBe(true)
    })

    it('errors when the resource is null', () => {
        const result = validateDocumentReference(null)
        expect(result).toHaveLength(1)
        expect(result[0]?.severity).toBe('ERROR')
    })

    it('errors when resourceType is not DocumentReference', () => {
        const result = validateDocumentReference({
            ...validDocumentReference,
            resourceType: 'Patient',
        } as never)
        expect(bad(result).some((v) => v.message.includes('is not of type DocumentReference'))).toBe(true)
    })

    it('complains if the id returned differs from the id provided', () => {
        const result = bad(validateDocumentReference(validDocumentReference, { id: 'wrong-id' }))
        expect(result).toHaveLength(1)
        expect(result[0]?.message).toBe(
            'DocumentReference.id was not the same as the id the probe wrote, was "sykmelding-123", expected "wrong-id". The FHIR server may have silently replaced a client-assigned id.',
        )
    })

    it('errors when status is missing', () => {
        const { status: _status, ...withoutStatus } = validDocumentReference
        const result = bad(validateDocumentReference(withoutStatus as DocumentReference))
        expect(result.some((v) => v.message.includes('does not contain a status field'))).toBe(true)
    })

    it('errors when status is not current', () => {
        const result = bad(validateDocumentReference({ ...validDocumentReference, status: 'superseded' }))
        expect(result.some((v) => v.message.includes('must be "current"'))).toBe(true)
    })

    it('errors when type.coding is missing', () => {
        const result = bad(validateDocumentReference({ ...validDocumentReference, type: {} }))
        expect(result.some((v) => v.message.includes('type.coding is missing or empty'))).toBe(true)
    })

    it('errors when type.coding does not contain the sykmelding document type system', () => {
        const result = bad(
            validateDocumentReference({
                ...validDocumentReference,
                type: { coding: [{ system: 'urn:oid:other', code: 'X' }] },
            }),
        )
        expect(result.some((v) => v.message.includes('does not contain a coding with system'))).toBe(true)
    })

    it('errors when the document type code is wrong', () => {
        const result = bad(
            validateDocumentReference({
                ...validDocumentReference,
                type: { coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.9602', code: 'J99-9' }] },
            }),
        )
        expect(result.some((v) => v.message.includes('must be "J01-2"'))).toBe(true)
    })

    it('errors when subject is missing', () => {
        const { subject: _subject, ...withoutSubject } = validDocumentReference
        const result = bad(validateDocumentReference(withoutSubject as DocumentReference))
        expect(result.some((v) => v.message.includes('does not contain a subject reference'))).toBe(true)
    })

    it('errors when subject reference is not a Patient', () => {
        const result = bad(
            validateDocumentReference({ ...validDocumentReference, subject: { reference: 'Group/1' } }),
        )
        expect(result.some((v) => v.message.includes('must be of type Patient'))).toBe(true)
    })

    it('errors when subject does not match the launch-context patient', () => {
        const result = bad(validateDocumentReference(validDocumentReference, { patientId: 'other-patient' }))
        expect(result.some((v) => v.message.includes('does not reference the launch-context patient'))).toBe(
            true,
        )
    })

    it('errors when author is missing', () => {
        const { author: _author, ...withoutAuthor } = validDocumentReference
        const result = bad(validateDocumentReference(withoutAuthor as DocumentReference))
        expect(result.some((v) => v.message.includes('does not contain an author reference'))).toBe(true)
    })

    it('errors when author reference is not a Practitioner', () => {
        const result = bad(
            validateDocumentReference({ ...validDocumentReference, author: [{ reference: 'Patient/1' }] }),
        )
        expect(result.some((v) => v.message.includes('must be of type Practitioner'))).toBe(true)
    })

    it('errors when author does not match the launch-context practitioner', () => {
        const result = bad(
            validateDocumentReference(validDocumentReference, { practitionerId: 'other-practitioner' }),
        )
        expect(
            result.some((v) => v.message.includes('does not reference the launch-context practitioner')),
        ).toBe(true)
    })

    it('errors when content is missing', () => {
        const result = bad(validateDocumentReference({ ...validDocumentReference, content: [] }))
        expect(result.some((v) => v.message.includes('does not contain a content object'))).toBe(true)
    })

    it('errors when attachment has neither data nor url', () => {
        const result = bad(
            validateDocumentReference({
                ...validDocumentReference,
                content: [{ attachment: { contentType: 'application/pdf' } }],
            }),
        )
        expect(
            result.some((v) => v.message.includes('has neither "data"') && v.message.includes('"url"')),
        ).toBe(true)
    })

    it('errors when inline data is present but contentType is not application/pdf', () => {
        const result = bad(
            validateDocumentReference({
                ...validDocumentReference,
                content: [{ attachment: { data: 'abc', contentType: 'text/plain' } }],
            }),
        )
        expect(result.some((v) => v.message.includes('must be "application/pdf"'))).toBe(true)
    })

    it('accepts the Binary-reference mechanism when url points at a Binary resource', () => {
        const result = bad(
            validateDocumentReference({
                ...validDocumentReference,
                content: [
                    {
                        attachment: {
                            url: 'Binary/abc-123',
                            contentType: 'application/pdf',
                            title: 'Sykmelding',
                            language: 'NO-nb',
                        },
                    },
                ],
            }),
        )
        expect(result).toEqual([])
    })

    it('errors when attachment.url does not reference a Binary resource', () => {
        const result = bad(
            validateDocumentReference({
                ...validDocumentReference,
                content: [{ attachment: { url: 'https://example.com/file.pdf' } }],
            }),
        )
        expect(result.some((v) => v.message.includes('must reference a Binary resource'))).toBe(true)
    })

    it('errors when context is missing', () => {
        const { context: _context, ...withoutContext } = validDocumentReference
        const result = bad(validateDocumentReference(withoutContext as DocumentReference))
        expect(result.some((v) => v.message.includes('does not contain a context object'))).toBe(true)
    })

    it('errors when context.encounter is missing (Folketrygdloven §8-7)', () => {
        const result = bad(validateDocumentReference({ ...validDocumentReference, context: {} }))
        expect(result.some((v) => v.message.includes('context.encounter is missing'))).toBe(true)
    })

    it('errors when context.encounter reference is not an Encounter', () => {
        const result = bad(
            validateDocumentReference({
                ...validDocumentReference,
                context: { encounter: [{ reference: 'Patient/1' }] },
            }),
        )
        expect(result.some((v) => v.message.includes('must be of type Encounter'))).toBe(true)
    })

    it('errors when context.encounter does not match the launch-context encounter', () => {
        const result = bad(
            validateDocumentReference(validDocumentReference, { encounterId: 'other-encounter' }),
        )
        expect(
            result.some((v) => v.message.includes('does not reference the launch-context encounter')),
        ).toBe(true)
    })

    it('errors when context.related is missing but a QuestionnaireResponse link was expected (ADR01)', () => {
        const result = bad(
            validateDocumentReference(validDocumentReference, {
                relatedQuestionnaireResponseId: 'sykmelding-123',
            }),
        )
        expect(result.some((v) => v.message.includes('context.related does not contain a reference'))).toBe(
            true,
        )
    })

    it('is OK when context.related correctly links to the expected QuestionnaireResponse', () => {
        const withRelated: DocumentReference = {
            ...validDocumentReference,
            context: {
                ...validDocumentReference.context,
                related: [{ reference: 'QuestionnaireResponse/sykmelding-123' }],
            },
        }
        const result = validateDocumentReference(withRelated, {
            relatedQuestionnaireResponseId: 'sykmelding-123',
        })
        expect(bad(result)).toEqual([])
        expect(result.some((v) => v.message.includes('correctly links to the QuestionnaireResponse'))).toBe(
            true,
        )
    })

    it('warns when description is missing', () => {
        const { description: _description, ...withoutDescription } = validDocumentReference
        const result = validateDocumentReference(withoutDescription as DocumentReference)
        expect(result.some((v) => v.severity === 'WARNING' && v.message.includes('description field'))).toBe(
            true,
        )
    })

    it('warns when date is missing', () => {
        const { date: _date, ...withoutDate } = validDocumentReference
        const result = validateDocumentReference(withoutDate as DocumentReference)
        expect(result.some((v) => v.severity === 'WARNING' && v.message.includes('date field'))).toBe(true)
    })
})
