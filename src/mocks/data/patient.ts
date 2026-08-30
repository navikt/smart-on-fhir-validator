import type { Patient } from 'fhir/r4'

import type { DefectSet } from '#mocks/defects'

import { fodselsnummer } from './checksums'
import { NO_BASIS_PROFILE, OID } from './oid'

export const PATIENT_ID = 'patient-espen-eksempel'

/** A synthetic fødselsnummer that passes the real modulus-11 check digits, never a real person. */
const ESPEN_FNR = fodselsnummer('010190', '501')

export function createPatient(defects: DefectSet): Patient {
    const identifierSystem = defects.has('patient-wrong-identifier-system')
        ? 'urn:oid:2.16.578.1.12.4.1.4.999' // not a recognised Norwegian identifier OID
        : OID.fodselsnummer

    return {
        resourceType: 'Patient',
        id: PATIENT_ID,
        meta: { profile: [NO_BASIS_PROFILE.patient] },
        ...(defects.has('patient-missing-identifier')
            ? {}
            : { identifier: [{ system: identifierSystem, value: ESPEN_FNR }] }),
        name: [{ family: 'Eksempel', given: ['Espen'] }],
        gender: 'male',
        birthDate: '1990-01-01',
    }
}
