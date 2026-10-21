import type { ActiveSession } from '#core/smart/types'

export type DebugSessionView = {
    fhirBaseUrl: string
    clientId: string
    grantedScope: string
    patient: string | null
    encounter: string | null
    fhirUser: string | null
    expiresAt: string
    refreshAvailable: boolean
    idTokenClaims: Record<string, unknown> | null
}

export function toDebugSessionView(session: ActiveSession): DebugSessionView {
    const { tokenResponse } = session

    return {
        fhirBaseUrl: session.fhirBaseUrl,
        clientId: session.clientId,
        grantedScope: tokenResponse.scope,
        patient: tokenResponse.patient ?? null,
        encounter: tokenResponse.encounter ?? null,
        fhirUser: tokenResponse.fhirUser ?? null,
        expiresAt: session.expiresAt,
        refreshAvailable: Boolean(tokenResponse.refresh_token),
        idTokenClaims: session.idTokenClaims,
    }
}
