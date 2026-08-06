import type { Encounter } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { requireBearerAuth } from './auth-middleware'
import { referenceMatches } from './reference-match'
import { createResourceRouter } from './resource-router'

export function encounterRouter(state: MockState) {
    return createResourceRouter<Encounter>({
        resourceType: 'Encounter',
        baseUrl: state.baseUrl,
        store: state.resources.Encounter,
        searchParams: {
            subject: (resource, value) => referenceMatches(resource.subject?.reference, value),
        },
        auth: requireBearerAuth(state, 'Encounter'),
    })
}
