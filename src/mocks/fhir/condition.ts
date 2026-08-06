import type { Condition } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { requireBearerAuth } from './auth-middleware'
import { referenceMatches } from './reference-match'
import { createResourceRouter } from './resource-router'

export function conditionRouter(state: MockState) {
    return createResourceRouter<Condition>({
        resourceType: 'Condition',
        baseUrl: state.baseUrl,
        store: state.resources.Condition,
        searchParams: {
            subject: (resource, value) => referenceMatches(resource.subject.reference, value),
            encounter: (resource, value) => referenceMatches(resource.encounter?.reference, value),
        },
        auth: requireBearerAuth(state, 'Condition'),
    })
}
