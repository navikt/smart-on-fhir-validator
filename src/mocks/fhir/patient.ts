import type { Patient } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { requireBearerAuth } from './auth-middleware'
import { createResourceRouter } from './resource-router'

export function patientRouter(state: MockState) {
    return createResourceRouter<Patient>({
        resourceType: 'Patient',
        baseUrl: state.baseUrl,
        store: state.resources.Patient,
        auth: requireBearerAuth(state, 'Patient'),
    })
}
