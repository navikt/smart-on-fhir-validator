import type { QuestionnaireResponse } from 'fhir/r4'

import { ENCOUNTER_ID } from './encounter'
import { PATIENT_ID } from './patient'

export const QUESTIONNAIRE_RESPONSE_ID = 'questionnaire-response-sykmelding'

export function createSeedQuestionnaireResponse(): QuestionnaireResponse {
    return {
        resourceType: 'QuestionnaireResponse',
        id: QUESTIONNAIRE_RESPONSE_ID,
        status: 'completed',
        questionnaire: 'http://example.org/fhir/Questionnaire/sykmelding',
        subject: { reference: `Patient/${PATIENT_ID}` },
        encounter: { reference: `Encounter/${ENCOUNTER_ID}` },
        item: [{ linkId: '1', text: 'Diagnose', answer: [{ valueString: 'Brudd legg/ankel' }] }],
    }
}
