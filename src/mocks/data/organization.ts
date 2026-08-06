import type { Organization } from 'fhir/r4'

import type { DefectSet } from '#mocks/defects'

import { organisasjonsnummer } from './checksums'
import { NO_BASIS_PROFILE, OID } from './oid'

export const ORGANIZATION_ID = 'organization-magnar-legekontor'

const ORGNR = organisasjonsnummer('98760000')

export function createOrganization(defects: DefectSet): Organization {
    return {
        resourceType: 'Organization',
        id: ORGANIZATION_ID,
        meta: { profile: [NO_BASIS_PROFILE.organization] },
        ...(defects.has('organization-missing-orgnr')
            ? {}
            : { identifier: [{ system: OID.organisasjonsnummer, value: ORGNR }] }),
        name: 'Magnar Legekontor AS',
        telecom: [
            { system: 'phone', value: '12345678' },
            { system: 'email', value: 'kontakt@magnar-legekontor.example' },
        ],
    }
}
