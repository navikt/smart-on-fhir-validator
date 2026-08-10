import { describe, expect, it } from 'vitest'

import { createExchangeRecorder } from './exchange'
import { SmartHttpClient } from './smart-http-client'

const REDACTED = '[REDACTED]'

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        return handler(url, init)
    }) as typeof fetch
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    })
}

describe('SmartHttpClient', () => {
    it('records a successful exchange with parsed JSON body, timestamps, and duration', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => jsonResponse({ status: 'ok' })),
        })

        const result = await client.get(
            'discovery',
            'https://ehr.example.com/.well-known/smart-configuration',
        )

        expect(result.ok).toBe(true)
        expect(result.status).toBe(200)
        expect(result.body).toEqual({ status: 'ok' })

        const [exchange] = recorder.all()
        expect(exchange).toBeDefined()
        expect(exchange?.phase).toBe('discovery')
        expect(exchange?.error).toBeNull()
        expect(exchange?.response?.status).toBe(200)
        expect(exchange?.response?.body).toEqual({ status: 'ok' })
        expect(typeof exchange?.id).toBe('string')
        expect(exchange?.id.length).toBeGreaterThan(0)
        expect(() => new Date(exchange?.startedAt ?? '').toISOString()).not.toThrow()
        expect(new Date(exchange?.startedAt ?? '').toISOString()).toBe(exchange?.startedAt)
        expect(typeof exchange?.durationMs).toBe('number')
        expect(exchange?.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('returns non-2xx responses rather than throwing, and records the exchange', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => jsonResponse({ error: 'not found' }, { status: 404 })),
        })

        const result = await client.get('capability', 'https://ehr.example.com/fhir/metadata')

        expect(result.ok).toBe(false)
        expect(result.status).toBe(404)
        expect(result.body).toEqual({ error: 'not found' })

        const [exchange] = recorder.all()
        expect(exchange?.error).toBeNull()
        expect(exchange?.response?.status).toBe(404)
    })

    it('returns null body for an empty response', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => new Response(null, { status: 204 })),
        })

        const result = await client.get('capability', 'https://ehr.example.com/fhir/metadata')

        expect(result.body).toBeNull()
        expect(recorder.all()[0]?.response?.body).toBeNull()
    })

    it('returns raw text as the body when the response is not valid JSON', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => new Response('<html>not json</html>', { status: 200 })),
        })

        const result = await client.get('capability', 'https://ehr.example.com/fhir/metadata')

        expect(result.body).toBe('<html>not json</html>')
    })

    it('produces an exchange with a null response and a populated error on transport failure', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => {
                throw new Error('getaddrinfo ENOTFOUND ehr.example.com')
            }),
        })

        const result = await client.get(
            'discovery',
            'https://ehr.example.com/.well-known/smart-configuration',
        )

        expect(result.ok).toBe(false)
        expect(result.status).toBe(0)
        expect(result.body).toBeNull()

        const [exchange] = recorder.all()
        expect(exchange?.response).toBeNull()
        expect(exchange?.error).toBe('getaddrinfo ENOTFOUND ehr.example.com')
        expect(typeof exchange?.durationMs).toBe('number')
        expect(exchange?.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('does not throw when fetchImpl rejects with a non-Error value', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(() => {
                throw 'a string rejection'
            }),
        })

        const result = await client.get('discovery', 'https://ehr.example.com/x')

        expect(result.ok).toBe(false)
        expect(recorder.all()[0]?.error).toBe('a string rejection')
    })

    it('redacts the Authorization header of the recorded request', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.get('fhir-read', 'https://ehr.example.com/fhir/Patient/1', {
            Authorization: 'Bearer super-secret-token',
        })

        expect(recorder.all()[0]?.request.headers['authorization']).toBe(REDACTED)
    })

    it('redacts sensitive query parameters in the recorded request URL, preserving FHIR search parameters', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.get(
            'fhir-read',
            'https://ehr.example.com/fhir/Observation?subject=Patient/1&access_token=abc',
        )

        const recordedUrl = new URL(recorder.all()[0]?.request.url ?? '')
        expect(recordedUrl.searchParams.get('subject')).toBe('Patient/1')
        expect(recordedUrl.searchParams.get('access_token')).toBe(REDACTED)
    })

    it('redacts sensitive fields in a postForm body while preserving other form fields', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.postForm('token', 'https://ehr.example.com/oauth/token', {
            grant_type: 'authorization_code',
            code: 'the-auth-code',
            client_secret: 'the-client-secret',
            client_id: 'my-client',
        })

        const recordedBody = new URLSearchParams(recorder.all()[0]?.request.body)
        expect(recordedBody.get('grant_type')).toBe('authorization_code')
        expect(recordedBody.get('client_id')).toBe('my-client')
        expect(recordedBody.get('code')).toBe(REDACTED)
        expect(recordedBody.get('client_secret')).toBe(REDACTED)
    })

    it('sets the correct Content-Type and method for postForm', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.postForm('token', 'https://ehr.example.com/oauth/token', { grant_type: 'refresh_token' })

        const request = recorder.all()[0]?.request
        expect(request?.method).toBe('POST')
        expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    })

    it('redacts sensitive fields nested in a postJson body while preserving id_token', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.postJson('registration', 'https://ehr.example.com/register', {
            client_name: 'Nav SMART Validator',
            id_token: 'header.payload.signature',
            credentials: { client_secret: 'buried-secret' },
            redirect_uris: ['https://app.example.com/callback'],
        })

        const recordedBody = JSON.parse(recorder.all()[0]?.request.body ?? '{}')
        expect(recordedBody.client_name).toBe('Nav SMART Validator')
        expect(recordedBody.id_token).toBe('header.payload.signature')
        expect(recordedBody.credentials.client_secret).toBe(REDACTED)
        expect(recordedBody.redirect_uris).toEqual(['https://app.example.com/callback'])
    })

    it('sets the correct Content-Type and method for postJson', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.postJson('registration', 'https://ehr.example.com/register', { client_name: 'App' })

        const request = recorder.all()[0]?.request
        expect(request?.method).toBe('POST')
        expect(request?.headers['content-type']).toBe('application/json')
    })

    it('redacts sensitive response headers and body fields, keeping the unredacted body available to the caller', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({
            recorder,
            fetchImpl: stubFetch(
                () =>
                    new Response(JSON.stringify({ access_token: 'live-token', patient: 'Patient/1' }), {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'Set-Cookie': 'session=abc',
                        },
                    }),
            ),
        })

        const result = await client.get('token', 'https://ehr.example.com/oauth/token')

        // The caller-facing, unredacted body still carries the real token.
        expect(result.body).toEqual({ access_token: 'live-token', patient: 'Patient/1' })

        const exchange = recorder.all()[0]
        expect(exchange?.response?.body).toEqual({ access_token: REDACTED, patient: 'Patient/1' })
        expect(exchange?.response?.headers['set-cookie']).toBe(REDACTED)
    })

    it('uses GET as the default method and merges custom headers', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.get('capability', 'https://ehr.example.com/fhir/metadata', {
            Accept: 'application/fhir+json',
        })

        const request = recorder.all()[0]?.request
        expect(request?.method).toBe('GET')
        expect(request?.headers['accept']).toBe('application/fhir+json')
    })

    it('accumulates exchanges across multiple calls on the same recorder', async () => {
        const recorder = createExchangeRecorder()
        const client = new SmartHttpClient({ recorder, fetchImpl: stubFetch(() => jsonResponse({})) })

        await client.get('discovery', 'https://ehr.example.com/a')
        await client.get('capability', 'https://ehr.example.com/b')

        expect(recorder.all()).toHaveLength(2)
        expect(recorder.all().map((exchange) => exchange.phase)).toEqual(['discovery', 'capability'])
    })
})
