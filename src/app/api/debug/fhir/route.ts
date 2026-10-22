import { NextResponse, type NextRequest } from 'next/server'

import { findIssuerConfig } from '#core/config/issuers'
import { DEBUG_ERROR_STATUS, executeDebugRequest, isDebugError } from '#core/debug/proxy'
import { MAX_DEBUG_BODY_BYTES, MAX_DEBUG_QUERY_LENGTH } from '#core/debug/request'
import { readSessionIdFromCookies } from '#core/session/session-cookie'
import { selectClientAuthentication } from '#core/smart/client-auth'
import { createSessionStore } from '#core/storage/session-store'

import { getAppOrigin } from '../../../app-origin'

export const runtime = 'nodejs'

const MAX_ENVELOPE_BYTES = MAX_DEBUG_BODY_BYTES * 6 + MAX_DEBUG_QUERY_LENGTH * 6 + 4096

function fail(status: number, error: string, detail: string): NextResponse {
    return NextResponse.json(
        { ok: false, error, detail },
        { status, headers: { 'Cache-Control': 'no-store' } },
    )
}

function isJsonContentType(value: string | null): boolean {
    return value?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

function tooLarge(): NextResponse {
    return fail(413, 'request_too_large', `The request may not exceed ${MAX_ENVELOPE_BYTES} bytes.`)
}

async function readBoundedText(request: NextRequest): Promise<string | null> {
    if (!request.body) return ''

    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        received += value.byteLength
        if (received > MAX_ENVELOPE_BYTES) {
            await reader.cancel()
            return null
        }
        chunks.push(value)
    }

    return new TextDecoder().decode(Buffer.concat(chunks))
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (request.headers.get('origin') !== (await getAppOrigin())) {
        return fail(403, 'cross_origin_request', 'The request origin does not match this application.')
    }

    if (!isJsonContentType(request.headers.get('content-type'))) {
        return fail(415, 'unsupported_media_type', 'The Content-Type must be application/json.')
    }

    const sessionId = await readSessionIdFromCookies()
    if (!sessionId) return fail(401, 'no_session', 'No active session. Launch from your EHR first.')

    const advertised = request.headers.get('content-length')
    if (advertised !== null && !(/^\d+$/.test(advertised) && Number(advertised) <= MAX_ENVELOPE_BYTES)) {
        return tooLarge()
    }

    const text = await readBoundedText(request)
    if (text === null) return tooLarge()

    let input: unknown
    try {
        input = JSON.parse(text)
    } catch {
        return fail(400, 'invalid_json', 'The request body is not valid JSON.')
    }

    const result = await executeDebugRequest(sessionId, input, {
        sessionStore: await createSessionStore(),
        findIssuerConfig,
        selectClientAuthentication,
    })

    if (isDebugError(result)) {
        return fail(DEBUG_ERROR_STATUS[result.error], result.error, result.detail)
    }

    return NextResponse.json(
        { ok: true, exchange: result.exchange, bodyTruncated: result.bodyTruncated },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}
