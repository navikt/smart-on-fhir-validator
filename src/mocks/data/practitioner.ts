import type { Practitioner } from 'fhir/r4'

import type { DefectSet } from '#mocks/defects'

import { NO_BASIS_PROFILE, OID } from './oid'

export const PRACTITIONER_ID = 'practitioner-sidsel-jarvery'

const HPR_NUMMER = '9144889'

export function createPractitioner(defects: DefectSet): Practitioner {
    return {
        resourceType: 'Practitioner',
        id: PRACTITIONER_ID,
        meta: { profile: [NO_BASIS_PROFILE.practitioner] },
        ...(defects.has('practitioner-missing-hpr')
            ? {}
            : { identifier: [{ system: OID.hprNummer, value: HPR_NUMMER }] }),
        name: [{ family: 'Jarvery', given: ['Sidsel', 'Aase'] }],
    }
}
