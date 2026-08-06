import type { Practitioner } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { requireBearerAuth } from './auth-middleware'
import { createResourceRouter } from './resource-router'

export function practitionerRouter(state: MockState) {
    return createResourceRouter<Practitioner>({
        resourceType: 'Practitioner',
        baseUrl: state.baseUrl,
        store: state.resources.Practitioner,
        auth: requireBearerAuth(state, 'Practitioner'),
    })
}
