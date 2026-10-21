import { describe, expect, it } from 'vitest'

import { selectClientAuthentication } from '#core/smart/client-auth'
import { FHIR_JSON, type DebugRequest } from '#core/debug/request'
import { requireSuccessfulLaunch } from '#test/mock-ehr'

import { type DebugResult, executeDebugRequest, isDebugError } from './proxy'

function debugRequest(overrides: Partial<DebugRequest>): DebugRequest {
    return { method: 'GET', resourceType: '', id: '', query: '', body: null, contentType: null, ...overrides }
}

async function launch() {
    const launched = await requireSuccessfulLaunch()
    const { app, session, sessionStore, issuerConfig } = launched

    const send = async (request: DebugRequest): Promise<DebugResult> => {
        const result = await executeDebugRequest(session.sessionId, request, {
            sessionStore,
            findIssuerConfig: () => issuerConfig,
            selectClientAuthentication,
            fetchImpl: (async (input, init) =>
                app.fetch(
                    input instanceof Request ? input : new Request(input as string | URL, init),
                )) as typeof fetch,
        })
        if (isDebugError(result)) throw new Error(`Unexpected debug error: ${JSON.stringify(result)}`)
        return result
    }

    return { ...launched, send }
}

describe('debug proxy against the mock EHR', () => {
    it('reads the launch Patient with a redacted token', async () => {
        const { send, session, launchContext } = await launch()

        const { exchange } = await send(
            debugRequest({ resourceType: 'Patient', id: launchContext.patientId ?? '' }),
        )

        expect(exchange.phase).toBe('debug')
        expect(exchange.response?.status).toBe(200)
        expect(exchange.response?.body).toMatchObject({
            resourceType: 'Patient',
            id: launchContext.patientId,
        })
        expect(exchange.request.headers.authorization).toBe('[REDACTED]')
        expect(JSON.stringify(exchange)).not.toContain(session.tokenResponse.access_token)
    })

    it('returns a 404 OperationOutcome for an unknown Patient id', async () => {
        const { send, session } = await launch()

        const { exchange } = await send(debugRequest({ resourceType: 'Patient', id: 'does-not-exist' }))

        expect(exchange.response?.status).toBe(404)
        expect(exchange.response?.body).toMatchObject({
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'not-found' }],
        })
        expect(exchange.request.headers.authorization).toBe('[REDACTED]')
        expect(JSON.stringify(exchange)).not.toContain(session.tokenResponse.access_token)
    })

    it('creates a minimal DocumentReference and keeps FHIR code data visible', async () => {
        const { send, session, launchContext } = await launch()
        const body = JSON.stringify({
            resourceType: 'DocumentReference',
            status: 'current',
            type: { coding: [{ system: 'http://loinc.org', code: '11488-4' }] },
            subject: { reference: `Patient/${launchContext.patientId}` },
            content: [{ attachment: { contentType: 'text/plain', data: 'SGVsbG8=' } }],
        })

        const { exchange } = await send(
            debugRequest({
                method: 'POST',
                resourceType: 'DocumentReference',
                body,
                contentType: FHIR_JSON,
            }),
        )

        expect(exchange.response?.status).toBe(201)
        expect(exchange.request.body).toContain('"code":"11488-4"')
        expect(JSON.stringify(exchange.response?.body)).toContain('11488-4')
        expect(exchange.request.headers.authorization).toBe('[REDACTED]')
        expect(JSON.stringify(exchange)).not.toContain(session.tokenResponse.access_token)
    })
})
