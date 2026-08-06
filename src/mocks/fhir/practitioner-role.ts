import { Hono } from 'hono'

import type { Bundle, FhirResource, PractitionerRole } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { fhirJson } from './bundle-helpers'
import { operationOutcome } from './operation-outcome'
import { referenceMatches } from './reference-match'
import { requireBearerAuth } from './auth-middleware'

const SUPPORTED_INCLUDE = 'PractitionerRole:organization'

export function practitionerRoleRouter(state: MockState): Hono {
    const app = new Hono()
    const { baseUrl, resources } = state

    app.use('*', requireBearerAuth(state, 'PractitionerRole'))

    app.get('/:id', (c) => {
        const id = c.req.param('id')
        const resource = resources.PractitionerRole.get(id)
        if (!resource) {
            return fhirJson(
                operationOutcome('error', 'not-found', `PractitionerRole/${id} does not exist`),
                404,
            )
        }

        return fhirJson(resource)
    })

    app.get('/', (c) => {
        const { practitioner, _include, ...rest } = c.req.query()
        const unsupported = Object.keys(rest)
        if (unsupported.length > 0) {
            return fhirJson(
                operationOutcome(
                    'error',
                    'not-supported',
                    `PractitionerRole does not support the search parameter(s): ${unsupported.join(', ')}`,
                ),
                400,
            )
        }

        if (_include !== undefined && _include !== SUPPORTED_INCLUDE) {
            return fhirJson(
                operationOutcome('error', 'not-supported', `Unsupported _include: ${_include}`),
                400,
            )
        }

        const matches = [...resources.PractitionerRole.values()].filter((role) =>
            practitioner === undefined ? true : referenceMatches(role.practitioner?.reference, practitioner),
        )

        const entries: NonNullable<Bundle<FhirResource>['entry']> = matches.map((role) => ({
            fullUrl: `${baseUrl}/PractitionerRole/${role.id}`,
            resource: role,
            search: { mode: 'match' },
        }))

        if (_include === SUPPORTED_INCLUDE) {
            for (const organization of includedOrganizations(matches, state)) {
                entries.push({
                    fullUrl: `${baseUrl}/Organization/${organization.id}`,
                    resource: organization,
                    search: { mode: 'include' },
                })
            }
        }

        const bundle: Bundle<FhirResource> = {
            resourceType: 'Bundle',
            type: 'searchset',
            total: matches.length,
            entry: entries,
        }

        return fhirJson(bundle)
    })

    return app
}

function includedOrganizations(roles: readonly PractitionerRole[], state: MockState) {
    const ids = new Set(
        roles
            .map((role) => role.organization?.reference?.split('/').pop())
            .filter((id): id is string => id !== undefined),
    )

    return [...ids].map((id) => state.resources.Organization.get(id)).filter((org) => org !== undefined)
}
