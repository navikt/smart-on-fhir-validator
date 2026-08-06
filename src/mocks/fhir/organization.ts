import type { Organization } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { requireBearerAuth } from './auth-middleware'
import { createResourceRouter } from './resource-router'

export function organizationRouter(state: MockState) {
    return createResourceRouter<Organization>({
        resourceType: 'Organization',
        baseUrl: state.baseUrl,
        store: state.resources.Organization,
        auth: requireBearerAuth(state, 'Organization'),
    })
}
