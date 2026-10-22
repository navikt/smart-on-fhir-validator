import { describe, expect, it } from 'vitest'

import type { ActiveSession } from '#core/smart/types'

import { toDebugSessionView } from './session-view'

const session: ActiveSession = {
    state: 'active',
    sessionId: 'session-id-secret',
    fhirBaseUrl: 'https://ehr.example.com/fhir',
    clientId: 'client-123',
    requestedScope: 'openid launch/patient',
    tokenResponse: {
        access_token: 'access-token-secret',
        token_type: 'Bearer',
        scope: 'openid fhirUser patient/Patient.read',
        refresh_token: 'refresh-token-secret',
        id_token: 'id-token-secret.payload.signature',
        patient: 'p1',
        encounter: 'e1',
        fhirUser: 'Practitioner/pr1',
    },
    expiresAt: '2030-01-01T00:00:00.000Z',
    idTokenClaims: { sub: 'user-1' },
    smartConfiguration: {
        issuer: 'https://ehr.example.com',
        token_endpoint: 'https://ehr.example.com/token',
    },
    createdAt: '2030-01-01T00:00:00.000Z',
    exchanges: [],
    clientAuthMethod: 'client_secret_basic',
}

describe('toDebugSessionView', () => {
    it('exposes only the whitelisted launch context', () => {
        expect(toDebugSessionView(session)).toEqual({
            fhirBaseUrl: 'https://ehr.example.com/fhir',
            grantedScope: 'openid fhirUser patient/Patient.read',
            patient: 'p1',
            encounter: 'e1',
            fhirUser: 'Practitioner/pr1',
            expiresAt: '2030-01-01T00:00:00.000Z',
            idTokenClaims: { sub: 'user-1' },
        })
    })

    it('never serialises a raw token or session id', () => {
        const serialised = JSON.stringify(toDebugSessionView(session))

        for (const secret of [
            'access-token-secret',
            'refresh-token-secret',
            'id-token-secret',
            'session-id-secret',
        ]) {
            expect(serialised).not.toContain(secret)
        }
        expect(serialised).not.toMatch(/access_token|refresh_token|id_token|client/)
    })
})
