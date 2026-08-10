import type { Coding, DocumentReference } from 'fhir/r4'

import { fullRefs, hl7Refs, navRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

/** urn:oid for "Dokumenttyper" (Helsedirektoratet, collection 9602). */
export const SYKMELDING_DOCUMENT_TYPE_SYSTEM = 'urn:oid:2.16.578.1.12.4.1.1.9602'
/** "Sykmeldinger og trygdesaker" within the Dokumenttyper code system. */
export const SYKMELDING_DOCUMENT_TYPE_CODE = 'J01-2'

/**
 * What the caller expects a written-back DocumentReference to actually say, taken from launch
 * context and from the payload the probe itself sent. `null`/`undefined` fields are not checked,
 * so this same function can validate a resource we just wrote (everything known) or one read back
 * with only launch context in hand.
 */
export type DocumentReferenceExpectations = {
    id?: string | null
    patientId?: string | null
    encounterId?: string | null
    practitionerId?: string | null
    /** Set when the sykmelding is also written as structured data (see `bundle.md` / ADR01). */
    relatedQuestionnaireResponseId?: string | null
}

/**
 * Validates a DocumentReference against the FHIR R4 shape and against Nav's sykmelding
 * write-back rules (`document-reference.md`, `bundle.md`, ADR01).
 *
 * Pure by design: takes a resource and what it should say, returns findings. No network access,
 * so every rule here is unit-testable without a FHIR server.
 */
export function validateDocumentReference(
    documentReference: DocumentReference | null,
    expectations: DocumentReferenceExpectations = {},
): Validation[] {
    const validator = new Validator()
    const ok: Validation[] = []

    if (documentReference == null) {
        validator.error('No DocumentReference was returned to validate', fullRefs.documentReference)
        return validator.build()
    }

    if (documentReference.resourceType !== 'DocumentReference') {
        validator.error(
            `Resource is not of type DocumentReference, was "${documentReference.resourceType}"`,
            fullRefs.documentReference,
        )
    }

    if (expectations.id != null) {
        if (documentReference.id === expectations.id) {
            ok.push(
                validation(
                    `DocumentReference.id matches the id the probe wrote ("${expectations.id}")`,
                    'OK',
                ),
            )
        } else {
            validator.error(
                `DocumentReference.id was not the same as the id the probe wrote, was "${documentReference.id ?? 'missing'}", expected "${expectations.id}". The FHIR server may have silently replaced a client-assigned id.`,
                fullRefs.documentReference,
            )
        }
    }

    if (!documentReference.status) {
        validator.error(
            'DocumentReference does not contain a status field, required by FHIR R4',
            fullRefs.documentReference,
        )
    } else if (documentReference.status !== 'current') {
        validator.error(
            `DocumentReference.status must be "current" for an active sykmelding, was "${documentReference.status}"`,
            fullRefs.documentReference,
        )
    } else {
        ok.push(validation('DocumentReference.status is "current"', 'OK'))
    }

    validateType(documentReference, validator, ok)
    validateSubject(documentReference, expectations, validator, ok)
    validateAuthor(documentReference, expectations, validator, ok)
    validateContent(documentReference, validator, ok)
    validateContext(documentReference, expectations, validator, ok)

    if (!documentReference.date) {
        validator.warn(
            'DocumentReference does not contain a date field. FHIR R4 recommends it for tracking, ordering and searching versions of the document.',
            [hl7Refs.documentReference],
        )
    } else {
        ok.push(validation('DocumentReference.date is present', 'OK'))
    }

    if (!documentReference.description) {
        validator.warn(
            'DocumentReference does not contain a description field. Nav generates descriptions like "100% Sykmelding fra DD.MM.YYYY til DD.MM.YYYY"',
            fullRefs.documentReference,
        )
    } else {
        ok.push(validation('DocumentReference.description is present', 'OK'))
    }

    return [...validator.build(), ...ok]
}

function validateType(documentReference: DocumentReference, validator: Validator, ok: Validation[]): void {
    if (!documentReference.type) {
        validator.error('DocumentReference does not contain a type object', fullRefs.documentReference)
        return
    }
    if (!documentReference.type.coding || documentReference.type.coding.length < 1) {
        validator.error(
            `DocumentReference.type.coding is missing or empty. Nav requires exactly one coding with system "${SYKMELDING_DOCUMENT_TYPE_SYSTEM}" and code "${SYKMELDING_DOCUMENT_TYPE_CODE}"`,
            fullRefs.documentReference,
        )
        return
    }

    const relevantType = documentReference.type.coding.find(
        (coding: Coding) => coding.system === SYKMELDING_DOCUMENT_TYPE_SYSTEM,
    )

    if (!relevantType) {
        validator.error(
            `DocumentReference.type.coding does not contain a coding with system "${SYKMELDING_DOCUMENT_TYPE_SYSTEM}" (Dokumenttyper), only found: ${documentReference.type.coding.map((coding) => coding.system ?? 'unknown').join(', ')}`,
            fullRefs.documentReference,
        )
        return
    }

    if (!relevantType.code) {
        validator.error(
            'DocumentReference.type coding with the Dokumenttyper system does not contain a code',
            fullRefs.documentReference,
        )
    } else if (relevantType.code !== SYKMELDING_DOCUMENT_TYPE_CODE) {
        validator.error(
            `DocumentReference.type code must be "${SYKMELDING_DOCUMENT_TYPE_CODE}" (Sykmeldinger og trygdesaker) for a sykmelding, was "${relevantType.code}"`,
            fullRefs.documentReference,
        )
    } else {
        ok.push(
            validation(
                `DocumentReference.type correctly codes a sykmelding (${SYKMELDING_DOCUMENT_TYPE_SYSTEM}#${SYKMELDING_DOCUMENT_TYPE_CODE})`,
                'OK',
            ),
        )
    }

    if (!relevantType.display) {
        validator.warn(
            'DocumentReference.type coding does not contain a human-readable display text',
            fullRefs.documentReference,
        )
    }
}

function validateSubject(
    documentReference: DocumentReference,
    expectations: DocumentReferenceExpectations,
    validator: Validator,
    ok: Validation[],
): void {
    if (!documentReference.subject?.reference) {
        validator.error(
            'DocumentReference does not contain a subject reference to the patient',
            fullRefs.documentReference,
        )
        return
    }

    const reference = documentReference.subject.reference

    if (!reference.startsWith('Patient/')) {
        validator.error(
            `DocumentReference.subject.reference must be of type Patient, was "${reference}"`,
            fullRefs.documentReference,
        )
        return
    }

    if (expectations.patientId != null) {
        const expected = `Patient/${expectations.patientId}`
        if (reference !== expected) {
            validator.error(
                `DocumentReference.subject.reference ("${reference}") does not reference the launch-context patient ("${expected}")`,
                fullRefs.documentReference,
            )
            return
        }
    }

    ok.push(validation(`DocumentReference.subject correctly references "${reference}"`, 'OK'))
}

function validateAuthor(
    documentReference: DocumentReference,
    expectations: DocumentReferenceExpectations,
    validator: Validator,
    ok: Validation[],
): void {
    if (!documentReference.author || documentReference.author.length < 1) {
        validator.error(
            'DocumentReference does not contain an author reference to the Practitioner who authorized the document',
            fullRefs.documentReference,
        )
        return
    }

    let anyValid = false
    documentReference.author.forEach((author) => {
        if (!author.reference) {
            validator.error(
                'DocumentReference author entry does not contain a reference',
                fullRefs.documentReference,
            )
        } else if (!author.reference.startsWith('Practitioner/')) {
            validator.error(
                `DocumentReference author reference must be of type Practitioner, was "${author.reference}"`,
                fullRefs.documentReference,
            )
        } else {
            anyValid = true
        }
    })

    if (!anyValid) return

    if (expectations.practitionerId != null) {
        const expected = `Practitioner/${expectations.practitionerId}`
        const matches = documentReference.author.some((author) => author.reference === expected)
        if (!matches) {
            validator.error(
                `DocumentReference.author does not reference the launch-context practitioner ("${expected}")`,
                fullRefs.documentReference,
            )
            return
        }
    }

    ok.push(validation('DocumentReference.author correctly references a Practitioner', 'OK'))
}

function validateContent(documentReference: DocumentReference, validator: Validator, ok: Validation[]): void {
    if (!documentReference.content || documentReference.content.length < 1) {
        validator.error(
            'DocumentReference does not contain a content object with the sykmelding PDF',
            fullRefs.documentReference,
        )
        return
    }

    documentReference.content.forEach((content, index) => {
        const label = documentReference.content.length > 1 ? `content[${index}]` : 'content[0]'

        if (!content.attachment) {
            validator.error(
                `DocumentReference.${label} does not contain an attachment object`,
                fullRefs.documentReference,
            )
            return
        }

        const { attachment } = content
        const hasInlineData = Boolean(attachment.data)
        const hasUrlReference = Boolean(attachment.url)

        if (!hasInlineData && !hasUrlReference) {
            validator.error(
                `DocumentReference.${label}.attachment has neither "data" (inline base64 PDF) nor "url" (reference to a Binary resource). Nav supports both write-back mechanisms.`,
                fullRefs.documentReference,
            )
            return
        }

        if (hasInlineData) {
            if (attachment.contentType !== 'application/pdf') {
                validator.error(
                    `DocumentReference.${label}.attachment.contentType must be "application/pdf" when using inline base64 data, was "${attachment.contentType ?? 'missing'}"`,
                    fullRefs.documentReference,
                )
            } else {
                ok.push(
                    validation(
                        `DocumentReference.${label}.attachment uses the inline base64 PDF mechanism with the correct contentType`,
                        'OK',
                    ),
                )
            }
        }

        if (hasUrlReference) {
            const url = attachment.url ?? ''
            if (!url.includes('Binary/')) {
                validator.error(
                    `DocumentReference.${label}.attachment.url must reference a Binary resource ("Binary/<id>"), was "${url}"`,
                    fullRefs.documentReference,
                )
            } else {
                ok.push(
                    validation(
                        `DocumentReference.${label}.attachment uses the Binary-reference mechanism ("${url}")`,
                        'OK',
                    ),
                )
            }
        }

        if (!attachment.language) {
            validator.warn(
                `DocumentReference.${label}.attachment does not contain a language field`,
                fullRefs.documentReference,
            )
        }

        if (!attachment.title) {
            validator.warn(
                `DocumentReference.${label}.attachment does not contain a title field`,
                fullRefs.documentReference,
            )
        }
    })
}

function validateContext(
    documentReference: DocumentReference,
    expectations: DocumentReferenceExpectations,
    validator: Validator,
    ok: Validation[],
): void {
    if (!documentReference.context) {
        validator.error(
            'DocumentReference does not contain a context object. Folketrygdloven §8-7 requires a reference to the consultation (context.encounter).',
            fullRefs.documentReference,
        )
        return
    }

    const encounterRef = documentReference.context.encounter?.[0]?.reference

    if (!encounterRef) {
        validator.error(
            'DocumentReference.context.encounter is missing. Folketrygdloven §8-7 requires a sykmelding to reference the consultation it was issued in.',
            fullRefs.documentReference,
        )
    } else if (!encounterRef.startsWith('Encounter/')) {
        validator.error(
            `DocumentReference.context.encounter[0].reference must be of type Encounter, was "${encounterRef}"`,
            fullRefs.documentReference,
        )
    } else if (expectations.encounterId != null && encounterRef !== `Encounter/${expectations.encounterId}`) {
        validator.error(
            `DocumentReference.context.encounter[0].reference ("${encounterRef}") does not reference the launch-context encounter ("Encounter/${expectations.encounterId}"). This breaks the requirement that the sykmelding is filed in the right consultation.`,
            fullRefs.documentReference,
        )
    } else {
        ok.push(
            validation(
                `DocumentReference.context.encounter correctly references "${encounterRef}" (Folketrygdloven §8-7)`,
                'OK',
            ),
        )
    }

    const relatedRefs = documentReference.context.related?.map((related) => related.reference) ?? []

    if (expectations.relatedQuestionnaireResponseId != null) {
        const expected = `QuestionnaireResponse/${expectations.relatedQuestionnaireResponseId}`
        if (!relatedRefs.includes(expected)) {
            validator.error(
                `DocumentReference.context.related does not contain a reference to the structured data ("${expected}"). ADR01 requires DocumentReference.context.related to link the two resources.`,
                [hl7Refs.documentReference, navRefs.adr01],
            )
        } else {
            ok.push(
                validation(
                    `DocumentReference.context.related correctly links to the QuestionnaireResponse ("${expected}"), per ADR01`,
                    'OK',
                ),
            )
        }
    } else if (relatedRefs.length > 0) {
        ok.push(
            validation(
                `DocumentReference.context.related is present (${relatedRefs.join(', ')}), though no structured QuestionnaireResponse was expected in this probe`,
                'INFO',
            ),
        )
    }
}
