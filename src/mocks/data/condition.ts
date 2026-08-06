import type { Condition } from 'fhir/r4'

import type { DefectSet } from '#mocks/defects'

import { OID } from './oid'
import { ENCOUNTER_ID } from './encounter'
import { PATIENT_ID } from './patient'

export const CONDITION_ID = 'condition-brudd-legg-ankel'

export function createCondition(defects: DefectSet): Condition {
    return {
        resourceType: 'Condition',
        id: CONDITION_ID,
        subject: { reference: `Patient/${PATIENT_ID}` },
        encounter: { reference: `Encounter/${ENCOUNTER_ID}` },
        code: {
            coding: [
                {
                    ...(defects.has('condition-missing-code-system') ? {} : { system: OID.icpc2 }),
                    code: 'L73',
                    display: 'Brudd legg/ankel',
                },
            ],
        },
    }
}
