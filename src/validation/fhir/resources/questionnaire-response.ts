import type { QuestionnaireResponse, QuestionnaireResponseItem } from 'fhir/r4'

import { fullRefs, hl7Refs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

/** Nav's canonical Questionnaire definition, published in the syk-inn repository (ADR01). */
export const SYKMELDING_QUESTIONNAIRE_CANONICAL_URL =
    'https://www.nav.no/samarbeidspartner/sykmelding/fhir/R4/Questionnaire/V1'

export type QuestionnaireResponseExpectations = {
    id?: string | null
    patientId?: string | null
    encounterId?: string | null
    practitionerId?: string | null
}

/**
 * Validates a QuestionnaireResponse against FHIR R4 and Nav's sykmelding structured-data
 * write-back rules (`questionnaire-response.md`, ADR01).
 */
export function validateQuestionnaireResponse(
    questionnaireResponse: QuestionnaireResponse | null,
    expectations: QuestionnaireResponseExpectations = {},
): Validation[] {
    const validator = new Validator()
    const ok: Validation[] = []

    if (questionnaireResponse == null) {
        validator.error('No QuestionnaireResponse was returned to validate', fullRefs.questionnaireResponse)
        return validator.build()
    }

    if (questionnaireResponse.resourceType !== 'QuestionnaireResponse') {
        validator.error(
            `Resource is not of type QuestionnaireResponse, was "${questionnaireResponse.resourceType}"`,
            fullRefs.questionnaireResponse,
        )
    }

    if (expectations.id != null) {
        if (questionnaireResponse.id === expectations.id) {
            ok.push(
                validation(
                    `QuestionnaireResponse.id matches the id the probe wrote ("${expectations.id}"), the same id used for the related DocumentReference`,
                    'OK',
                ),
            )
        } else {
            validator.error(
                `QuestionnaireResponse.id was not the same as the id the probe wrote, was "${questionnaireResponse.id ?? 'missing'}", expected "${expectations.id}"`,
                fullRefs.questionnaireResponse,
            )
        }
    }

    if (!questionnaireResponse.status) {
        validator.error(
            'QuestionnaireResponse does not contain a status field, required by FHIR R4',
            fullRefs.questionnaireResponse,
        )
    } else if (questionnaireResponse.status !== 'completed') {
        validator.error(
            `QuestionnaireResponse.status must be "completed" for a submitted sykmelding, was "${questionnaireResponse.status}"`,
            fullRefs.questionnaireResponse,
        )
    } else {
        ok.push(validation('QuestionnaireResponse.status is "completed"', 'OK'))
    }

    if (!questionnaireResponse.questionnaire) {
        validator.error(
            "QuestionnaireResponse.questionnaire is missing. It must reference the canonical URL of Nav's published Questionnaire definition.",
            fullRefs.questionnaireResponse,
        )
    } else if (questionnaireResponse.questionnaire !== SYKMELDING_QUESTIONNAIRE_CANONICAL_URL) {
        validator.error(
            `QuestionnaireResponse.questionnaire must be "${SYKMELDING_QUESTIONNAIRE_CANONICAL_URL}", was "${questionnaireResponse.questionnaire}"`,
            fullRefs.questionnaireResponse,
        )
    } else {
        ok.push(
            validation("QuestionnaireResponse.questionnaire correctly references Nav's canonical URL", 'OK'),
        )
    }

    validateReference(
        'subject',
        questionnaireResponse.subject?.reference,
        'Patient',
        expectations.patientId,
        validator,
        ok,
    )
    validateReference(
        'encounter',
        questionnaireResponse.encounter?.reference,
        'Encounter',
        expectations.encounterId,
        validator,
        ok,
    )
    validateReference(
        'author',
        questionnaireResponse.author?.reference,
        'Practitioner',
        expectations.practitionerId,
        validator,
        ok,
    )

    if (!questionnaireResponse.authored) {
        validator.warn(
            'QuestionnaireResponse.authored is missing. FHIR R4 recommends populating it with when the sick note was filled in.',
            fullRefs.questionnaireResponse,
        )
    } else {
        ok.push(validation('QuestionnaireResponse.authored is present', 'OK'))
    }

    validateItemTree(questionnaireResponse.item ?? [], 'item', validator, ok)

    return [...validator.build(), ...ok]
}

function validateReference(
    field: 'subject' | 'encounter' | 'author',
    reference: string | undefined,
    expectedType: 'Patient' | 'Encounter' | 'Practitioner',
    expectedId: string | null | undefined,
    validator: Validator,
    ok: Validation[],
): void {
    if (!reference) {
        validator.error(
            `QuestionnaireResponse.${field} is missing a reference to ${expectedType}`,
            fullRefs.questionnaireResponse,
        )
        return
    }

    if (!reference.startsWith(`${expectedType}/`)) {
        validator.error(
            `QuestionnaireResponse.${field}.reference must be of type ${expectedType}, was "${reference}"`,
            fullRefs.questionnaireResponse,
        )
        return
    }

    if (expectedId != null && reference !== `${expectedType}/${expectedId}`) {
        validator.error(
            `QuestionnaireResponse.${field}.reference ("${reference}") does not reference the launch-context ${expectedType} ("${expectedType}/${expectedId}")`,
            fullRefs.questionnaireResponse,
        )
        return
    }

    ok.push(validation(`QuestionnaireResponse.${field} correctly references "${reference}"`, 'OK'))
}

/**
 * FHIR R4: "Groups cannot have answers and therefore must nest directly within item." Nav's item
 * tree follows this — a group item carries only nested `item`, a leaf item only `answer`.
 */
function validateItemTree(
    items: QuestionnaireResponseItem[],
    path: string,
    validator: Validator,
    ok: Validation[],
): void {
    items.forEach((item, index) => {
        const label = `${path}[${index}]`

        if (!item.linkId) {
            validator.error(`${label} does not contain a linkId`, [hl7Refs.questionnaireResponse])
        } else {
            ok.push(validation(`${label} ("${item.linkId}") has a linkId`, 'OK'))
        }

        const hasAnswer = Boolean(item.answer && item.answer.length > 0)
        const hasNestedItem = Boolean(item.item && item.item.length > 0)

        if (hasAnswer && hasNestedItem) {
            validator.error(
                `${label} ("${item.linkId ?? 'unknown'}") has both "answer" and nested "item". FHIR R4 groups cannot have answers: a group item must only nest "item", and a question item must only carry "answer".`,
                [hl7Refs.questionnaireResponse],
            )
        }

        if (hasAnswer) {
            item.answer?.forEach((answer) => {
                const valueKeys = Object.keys(answer).filter((key) => key.startsWith('value'))
                if (valueKeys.length < 1) {
                    validator.error(
                        `${label} ("${item.linkId ?? 'unknown'}") has an answer with no value[x] field`,
                        [hl7Refs.questionnaireResponse],
                    )
                }
            })
        }

        if (hasNestedItem && item.item) {
            validateItemTree(item.item, `${label}.item`, validator, ok)
        }
    })
}
