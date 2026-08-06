import type { Binary } from 'fhir/r4'
import { describe, expect, it } from 'vitest'

import type { Validation } from '#validation/validation'

import { validateBinary } from './binary'

function bad(validations: Validation[]): Validation[] {
    return validations.filter((v) => v.severity !== 'OK' && v.severity !== 'INFO')
}

const validBinary: Binary = {
    resourceType: 'Binary',
    id: 'binary-1',
    contentType: 'application/pdf',
    data: 'YmFzZTY0LXBkZg==',
}

describe('validateBinary', () => {
    it('has no bad findings for a fully valid Binary', () => {
        expect(bad(validateBinary(validBinary))).toEqual([])
    })

    it('has no bad findings and reports OKs when expectations match', () => {
        const result = validateBinary(validBinary, { id: 'binary-1', contentType: 'application/pdf' })
        expect(bad(result)).toEqual([])
        expect(result.some((v) => v.severity === 'OK')).toBe(true)
    })

    it('errors when the resource is null', () => {
        const result = validateBinary(null)
        expect(result).toHaveLength(1)
        expect(result[0]?.severity).toBe('ERROR')
    })

    it('errors when resourceType is not Binary', () => {
        const result = bad(validateBinary({ ...validBinary, resourceType: 'DocumentReference' } as never))
        expect(result.some((v) => v.message.includes('is not of type Binary'))).toBe(true)
    })

    it('errors when id does not match what was written', () => {
        const result = bad(validateBinary(validBinary, { id: 'other-id' }))
        expect(result.some((v) => v.message.includes('Binary.id was not the same'))).toBe(true)
    })

    it('errors when contentType is missing', () => {
        const { contentType: _contentType, ...withoutContentType } = validBinary
        const result = bad(validateBinary(withoutContentType as Binary))
        expect(result.some((v) => v.message.includes('contentType is missing'))).toBe(true)
    })

    it('errors when contentType does not match what was written', () => {
        const result = bad(validateBinary(validBinary, { contentType: 'image/png' }))
        expect(result.some((v) => v.message.includes('does not match what was written'))).toBe(true)
    })

    it('warns when data is empty on read-back', () => {
        const { data: _data, ...withoutData } = validBinary
        const result = validateBinary(withoutData as Binary)
        expect(
            result.some((v) => v.severity === 'WARNING' && v.message.includes('Binary.data is empty')),
        ).toBe(true)
    })

    it('warns when securityContext was expected but not round-tripped', () => {
        const result = validateBinary(validBinary, { securityContext: 'DocumentReference/doc-1' })
        expect(
            result.some(
                (v) =>
                    v.severity === 'WARNING' && v.message.includes('securityContext was not round-tripped'),
            ),
        ).toBe(true)
    })

    it('is OK when securityContext matches what was expected', () => {
        const withSecurityContext: Binary = {
            ...validBinary,
            securityContext: { reference: 'DocumentReference/doc-1' },
        }
        const result = validateBinary(withSecurityContext, { securityContext: 'DocumentReference/doc-1' })
        expect(bad(result)).toEqual([])
        expect(result.some((v) => v.message.includes('securityContext was correctly round-tripped'))).toBe(
            true,
        )
    })
})
