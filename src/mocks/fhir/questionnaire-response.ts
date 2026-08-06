import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'

import type { QuestionnaireResponse } from 'fhir/r4'

import type { MockState } from '#mocks/state'

import { fhirJson } from './bundle-helpers'
import { operationOutcome } from './operation-outcome'
import { referenceMatches } from './reference-match'
import { createResourceRouter, type WriteOutcome } from './resource-router'
import { requireBearerAuth } from './auth-middleware'

export function questionnaireResponseRouter(state: MockState): Hono {
    if (state.defects.has('questionnaire-response-unsupported')) {
        const app = new Hono()
        app.all('*', () =>
            fhirJson(
                operationOutcome(
                    'error',
                    'not-supported',
                    'QuestionnaireResponse is not a supported resource type on this server',
                ),
                404,
            ),
        )
        return app
    }

    return createResourceRouter<QuestionnaireResponse>({
        resourceType: 'QuestionnaireResponse',
        baseUrl: state.baseUrl,
        store: state.resources.QuestionnaireResponse,
        searchParams: {
            subject: (resource, value) => referenceMatches(resource.subject?.reference, value),
            questionnaire: (resource, value) => resource.questionnaire === value,
        },
        onCreate: (body) => validateWrite(body),
        onUpdate: (id, body) => validateWrite({ ...asRecord(body), id }),
        auth: requireBearerAuth(state, 'QuestionnaireResponse'),
    })
}

function asRecord(body: unknown): Record<string, unknown> {
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

function validateWrite(body: unknown): WriteOutcome<QuestionnaireResponse> {
    const candidate = asRecord(body)
    if (candidate.resourceType !== undefined && candidate.resourceType !== 'QuestionnaireResponse') {
        return {
            ok: false,
            status: 422,
            outcome: operationOutcome('error', 'invalid', 'resourceType must be "QuestionnaireResponse"'),
        }
    }

    if (typeof candidate.status !== 'string') {
        return {
            ok: false,
            status: 422,
            outcome: operationOutcome('error', 'required', 'QuestionnaireResponse.status is required'),
        }
    }

    const id = typeof candidate.id === 'string' ? candidate.id : randomUUID()
    return {
        ok: true,
        resource: { ...candidate, id, resourceType: 'QuestionnaireResponse' } as QuestionnaireResponse,
    }
}
