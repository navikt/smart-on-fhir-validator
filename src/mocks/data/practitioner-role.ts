import type { PractitionerRole } from 'fhir/r4'

import { ORGANIZATION_ID } from './organization'
import { PRACTITIONER_ID } from './practitioner'

export const PRACTITIONER_ROLE_ID = 'practitioner-role-sidsel-jarvery'

export function createPractitionerRole(): PractitionerRole {
    return {
        resourceType: 'PractitionerRole',
        id: PRACTITIONER_ROLE_ID,
        practitioner: { reference: `Practitioner/${PRACTITIONER_ID}` },
        organization: { reference: `Organization/${ORGANIZATION_ID}` },
        code: [
            {
                coding: [{ system: 'urn:oid:2.16.578.1.12.4.1.1.9060', code: 'LE', display: 'Lege' }],
            },
        ],
    }
}
