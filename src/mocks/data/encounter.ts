import type { Encounter } from 'fhir/r4'

import type { DefectSet } from '#mocks/defects'

import { OID } from './oid'
import { ORGANIZATION_ID } from './organization'
import { PATIENT_ID } from './patient'
import { PRACTITIONER_ID } from './practitioner'

export const ENCOUNTER_ID = 'encounter-espen-1'

/** Kontakttype 1 = "Fysisk oppmøte" per the Norwegian kontakttype code system. */
const KONTAKTTYPE_FYSISK_OPPMOTE = { system: OID.kontakttype, code: '1', display: 'Fysisk oppmøte' }

export function createEncounter(defects: DefectSet): Encounter {
    return {
        resourceType: 'Encounter',
        id: ENCOUNTER_ID,
        status: 'finished',
        // `class` is required on `Encounter`; the cast is deliberate: this defect exists to
        // produce a resource that violates that requirement.
        ...(defects.has('encounter-missing-class') ? {} : { class: KONTAKTTYPE_FYSISK_OPPMOTE }),
        subject: { reference: `Patient/${PATIENT_ID}` },
        participant: [{ individual: { reference: `Practitioner/${PRACTITIONER_ID}` } }],
        ...(defects.has('encounter-missing-service-provider')
            ? {}
            : { serviceProvider: { reference: `Organization/${ORGANIZATION_ID}` } }),
    } as Encounter
}
