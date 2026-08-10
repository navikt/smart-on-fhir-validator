import type { RecordedResponse, SmartHttpClient } from '#core/http/smart-http-client'

export type FhirSearchParams = Record<string, string | string[] | undefined>

export type FhirClientOptions = {
    http: SmartHttpClient
    /** The `serverUrl` handed out in the token response, without a trailing slash. */
    baseUrl: string
    accessToken: string
}

/**
 * Builds a FHIR R4 search URL. The read phase must reach every resource from launch context
 * alone, so searches are built from named parameters rather than from a known id.
 */
export function buildSearchUrl(baseUrl: string, resourceType: string, params: FhirSearchParams): string {
    const search = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue
        if (Array.isArray(value)) {
            for (const entry of value) search.append(key, entry)
        } else {
            search.append(key, value)
        }
    }

    const query = search.toString()
    const base = baseUrl.replace(/\/+$/, '')

    return query.length > 0 ? `${base}/${resourceType}?${query}` : `${base}/${resourceType}`
}

/**
 * A thin FHIR R4 client that deliberately does not normalise, retry or validate: the report must
 * show the vendor exactly what their own server returned, alongside the recorded exchange.
 */
export class FhirClient {
    private readonly http: SmartHttpClient
    private readonly baseUrl: string
    private readonly accessToken: string

    constructor({ http, baseUrl, accessToken }: FhirClientOptions) {
        this.http = http
        this.baseUrl = baseUrl.replace(/\/+$/, '')
        this.accessToken = accessToken
    }

    private headers(extra: Record<string, string> = {}): Record<string, string> {
        return {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: 'application/fhir+json',
            ...extra,
        }
    }

    /** `GET [base]/[type]/[id]` — only legal when the id came from launch context. */
    read(resourceType: string, id: string): Promise<RecordedResponse> {
        return this.http.get('fhir-read', `${this.baseUrl}/${resourceType}/${id}`, this.headers())
    }

    search(resourceType: string, params: FhirSearchParams): Promise<RecordedResponse> {
        return this.http.get('fhir-read', buildSearchUrl(this.baseUrl, resourceType, params), this.headers())
    }

    create(resourceType: string, resource: unknown): Promise<RecordedResponse> {
        return this.http.send('fhir-write', `${this.baseUrl}/${resourceType}`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/fhir+json' }),
            body: JSON.stringify(resource),
        })
    }

    /**
     * Update as create, with a client-assigned id derived from the sykmelding: re-sending the
     * same document must be idempotent rather than duplicate it in the journal.
     */
    update(resourceType: string, id: string, resource: unknown): Promise<RecordedResponse> {
        return this.http.send('fhir-write', `${this.baseUrl}/${resourceType}/${id}`, {
            method: 'PUT',
            headers: this.headers({ 'Content-Type': 'application/fhir+json' }),
            body: JSON.stringify(resource),
        })
    }

    /**
     * R4 allows a Binary as either a FHIR resource or bare bytes with the payload's own media
     * type. Servers commonly support only one, so both mechanisms are probed.
     */
    createBinaryRaw(contentType: string, body: BodyInit): Promise<RecordedResponse> {
        return this.http.send('fhir-write', `${this.baseUrl}/Binary`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': contentType }),
            body,
        })
    }

    submitBundle(bundle: unknown): Promise<RecordedResponse> {
        return this.http.send('fhir-write', this.baseUrl, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/fhir+json' }),
            body: JSON.stringify(bundle),
        })
    }
}
