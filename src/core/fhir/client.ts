import type { RecordedResponse, SmartHttpClient } from '#core/http/smart-http-client'

export type FhirSearchParams = Record<string, string | string[] | undefined>

export type FhirClientOptions = {
    http: SmartHttpClient
    /** The `serverUrl` handed out in the token response, without a trailing slash. */
    baseUrl: string
    accessToken: string
}

/**
 * Builds a FHIR R4 search URL.
 *
 * Search parameters are the whole point of the validator's read phase: every resource must be
 * reachable from launch context alone, so the URL is built from named parameters rather than
 * from an id the app happened to already know.
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
 * A thin, honest FHIR R4 client.
 *
 * It deliberately does not normalise, retry or validate. Every response is returned exactly as
 * the EHR sent it, together with the recorded exchange, because the report has to be able to
 * show the vendor what their own server returned.
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

    /** `GET [base]/[type]?[params]` */
    search(resourceType: string, params: FhirSearchParams): Promise<RecordedResponse> {
        return this.http.get('fhir-read', buildSearchUrl(this.baseUrl, resourceType, params), this.headers())
    }

    /** `POST [base]/[type]` */
    create(resourceType: string, resource: unknown): Promise<RecordedResponse> {
        return this.http.send('fhir-write', `${this.baseUrl}/${resourceType}`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/fhir+json' }),
            body: JSON.stringify(resource),
        })
    }

    /**
     * `PUT [base]/[type]/[id]` — update as create, with a client-assigned id.
     *
     * This is how Nav writes back: the id is derived from the sykmelding, so re-sending the
     * same document is idempotent rather than producing a duplicate in the journal.
     */
    update(resourceType: string, id: string, resource: unknown): Promise<RecordedResponse> {
        return this.http.send('fhir-write', `${this.baseUrl}/${resourceType}/${id}`, {
            method: 'PUT',
            headers: this.headers({ 'Content-Type': 'application/fhir+json' }),
            body: JSON.stringify(resource),
        })
    }

    /**
     * `POST [base]/Binary` with the payload as the raw HTTP body.
     *
     * R4 allows a Binary to be sent either as a FHIR resource or as the bare bytes with the
     * payload's own media type. Servers commonly support only one, so both are worth testing.
     */
    createBinaryRaw(contentType: string, body: BodyInit): Promise<RecordedResponse> {
        return this.http.send('fhir-write', `${this.baseUrl}/Binary`, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': contentType }),
            body,
        })
    }

    /** `POST [base]` with a `batch` or `transaction` Bundle. */
    submitBundle(bundle: unknown): Promise<RecordedResponse> {
        return this.http.send('fhir-write', this.baseUrl, {
            method: 'POST',
            headers: this.headers({ 'Content-Type': 'application/fhir+json' }),
            body: JSON.stringify(bundle),
        })
    }
}
