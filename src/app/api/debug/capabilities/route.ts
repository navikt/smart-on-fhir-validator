import { NextResponse } from 'next/server'

import { summarizeCapabilityStatement } from '#core/debug/capabilities'
import { MAX_DEBUG_BODY_BYTES } from '#core/debug/request'
import { createExchangeRecorder } from '#core/http/exchange'
import { SmartHttpClient, TRUNCATED_BODY_MARKER } from '#core/http/smart-http-client'
import { readSessionIdFromCookies } from '#core/session/session-cookie'
import { fetchCapabilityStatement } from '#core/smart/capability-statement'
import { createSessionStore } from '#core/storage/session-store'

export const runtime = 'nodejs'

const TIMEOUT_MS = 15_000

function fail(status: number, error: string, detail: string): NextResponse {
    return NextResponse.json(
        { ok: false, error, detail },
        { status, headers: { 'Cache-Control': 'no-store' } },
    )
}

export async function GET(): Promise<NextResponse> {
    const sessionId = await readSessionIdFromCookies()
    if (!sessionId) return fail(401, 'no_session', 'No active session. Launch from your EHR first.')

    const session = await (await createSessionStore()).get(sessionId)
    if (!session || session.state !== 'active') {
        return fail(401, 'no_session', 'No active session. Launch from your EHR first.')
    }

    const recorder = createExchangeRecorder()
    const client = new SmartHttpClient({
        recorder,
        timeoutMs: TIMEOUT_MS,
        maxResponseBytes: MAX_DEBUG_BODY_BYTES,
    })

    const result = await fetchCapabilityStatement(client, session.fhirBaseUrl, { redirect: 'manual' })

    if ('error' in result) {
        const truncated = recorder.all().some((exchange) => exchange.response?.body === TRUNCATED_BODY_MARKER)
        if (truncated) {
            return fail(
                502,
                'capability_statement_too_large',
                `The CapabilityStatement exceeded ${MAX_DEBUG_BODY_BYTES} bytes.`,
            )
        }
        return fail(502, 'capability_statement_unavailable', result.error)
    }

    return NextResponse.json(
        { ok: true, capabilities: summarizeCapabilityStatement(result.capabilityStatement) },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}
