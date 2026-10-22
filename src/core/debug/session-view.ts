import type { ActiveSession } from '#core/smart/types'

export type DebugSessionView = {
    fhirBaseUrl: string
    grantedScope: string
    patient: string | null
    encounter: string | null
    fhirUser: string | null
    expiresAt: string
    idTokenClaims: Record<string, unknown> | null
}

export function toDebugSessionView(session: ActiveSession): DebugSessionView {
    const { tokenResponse } = session

    return {
        fhirBaseUrl: session.fhirBaseUrl,
        grantedScope: tokenResponse.scope,
        patient: tokenResponse.patient ?? null,
        encounter: tokenResponse.encounter ?? null,
        fhirUser: tokenResponse.fhirUser ?? null,
        expiresAt: session.expiresAt,
        idTokenClaims: session.idTokenClaims,
    }
}
