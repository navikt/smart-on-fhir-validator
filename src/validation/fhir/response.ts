/**
 * Shared checks every read/search response must pass before a probe looks at the resource itself:
 * transport, the status code FHIR R4 requires, `Content-Type`, an `OperationOutcome` returned in
 * place of the resource, and, for a search, that the body is a `searchset` Bundle.
 *
 * @see https://hl7.org/fhir/R4/http.html
 * @see https://hl7.org/fhir/R4/search.html
 */

import type { Bundle, BundleEntry, FhirResource, OperationOutcome } from 'fhir/r4'

import type { RecordedResponse } from '#core/http/smart-http-client'
import { hl7Refs } from '#validation/common-refs'
import { parseScope } from '#validation/smart/scopes'
import { validation, type Severity, type Validation } from '#validation/validation'

export type Interaction = 'read' | 'search'

const SEVERITY_ORDER: Record<Severity, number> = { OK: 0, INFO: 1, WARNING: 2, ERROR: 3 }

/**
 * Caps severity for checks that are informative extras (e.g. an optional search beyond the read
 * that already satisfied Nav's requirement), so they never look as serious as the main check.
 */
export function capSeverity(validations: readonly Validation[], max: Severity): Validation[] {
    return validations.map((entry) =>
        SEVERITY_ORDER[entry.severity] > SEVERITY_ORDER[max] ? { ...entry, severity: max } : entry,
    )
}

/**
 * Whether any granted scope authorizes `interaction` on `resourceType`. Both SMART v1
 * (`read`/`write`/`*`) and v2 (CRUDS letters) syntax are accepted, since EHRs may grant either.
 */
export function grantsFhirAccess(
    grantedScopes: readonly string[],
    resourceType: string,
    interaction: Interaction,
): boolean {
    const letter = interaction === 'read' ? 'r' : 's'

    return grantedScopes.some((raw) => {
        const scope = parseScope(raw)
        if (scope.kind !== 'clinical') return false
        if (scope.resource !== '*' && scope.resource !== resourceType) return false

        return scope.cruds.includes(letter)
    })
}

function callLabel(url: string, exchangeId: string): string {
    return `\`GET ${url}\` (exchange ${exchangeId})`
}

function transportFailureFinding(response: RecordedResponse, url: string): Validation {
    const detail = response.exchange.error ? `: ${response.exchange.error}` : ''

    return validation(
        `${callLabel(url, response.exchange.id)} failed at the transport level${detail}; the endpoint ` +
            'could not be reached at all, so Nav cannot pre-fill from it.',
        'ERROR',
        [hl7Refs.httpApi],
    )
}

function checkStatusCode(
    response: RecordedResponse,
    options: {
        url: string
        resourceType: string
        interaction: Interaction
        grantedScopes: readonly string[]
        expectedStatus: number
    },
): Validation {
    const { url, resourceType, interaction, grantedScopes, expectedStatus } = options
    const label = interaction === 'read' ? 'Read' : 'Search'
    const call = callLabel(url, response.exchange.id)

    if (response.status === 401) {
        return validation(
            `${label} ${call} returned 401 Unauthorized; the access token was not accepted at all. ` +
                'Verify the Bearer token is present, unexpired, and sent on every FHIR request.',
            'ERROR',
            [hl7Refs.httpApi],
        )
    }

    if (response.status === 403) {
        const hasAccess = grantsFhirAccess(grantedScopes, resourceType, interaction)
        const grantedList = grantedScopes.length > 0 ? grantedScopes.join(' ') : '(none)'

        return validation(
            `${label} ${call} returned 403 Forbidden: ${
                hasAccess
                    ? `the granted scopes (${grantedList}) do appear to cover ${interaction} access to ` +
                      `${resourceType}, so the server is refusing the request for another reason`
                    : `the granted scopes (${grantedList}) did not include ${interaction} access to ` +
                      `${resourceType} (e.g. \`patient/${resourceType}.${interaction === 'read' ? 'rs' : 'rs'}\` ` +
                      `or the SMART v1 \`patient/${resourceType}.read\`)`
            }.`,
            'ERROR',
            [hl7Refs.httpApi],
        )
    }

    if (response.status !== expectedStatus) {
        return validation(
            `${label} ${call} returned ${response.status}; FHIR R4 requires ${expectedStatus} for a ` +
                `successful ${interaction} interaction.`,
            'ERROR',
            [hl7Refs.httpApi],
        )
    }

    return validation(`${label} ${call} returned ${expectedStatus} as FHIR R4 requires.`, 'OK', [
        hl7Refs.httpApi,
    ])
}

function checkContentType(response: RecordedResponse, url: string, label: string): Validation {
    const call = callLabel(url, response.exchange.id)
    const raw = response.headers.get('content-type')
    const mediaType = raw?.split(';')[0]?.trim().toLowerCase() ?? null

    if (mediaType === 'application/fhir+json') {
        return validation(
            `${label} ${call} returned \`Content-Type: application/fhir+json\` as FHIR R4 requires.`,
            'OK',
            [hl7Refs.httpApi],
        )
    }

    if (mediaType === 'application/json') {
        return validation(
            `${label} ${call} returned \`Content-Type: application/json\` instead of the FHIR-specific ` +
                '`application/fhir+json`; FHIR R4 requires the latter.',
            'WARNING',
            [hl7Refs.httpApi],
        )
    }

    return validation(
        `${label} ${call} returned \`Content-Type: ${raw ?? '(missing)'}\` instead of ` +
            '`application/fhir+json` as FHIR R4 requires.',
        'ERROR',
        [hl7Refs.httpApi],
    )
}

export function isOperationOutcome(body: unknown): body is OperationOutcome {
    return (
        typeof body === 'object' &&
        body !== null &&
        (body as { resourceType?: unknown }).resourceType === 'OperationOutcome'
    )
}

function issueSeverity(severity: OperationOutcome['issue'][number]['severity']): Severity {
    if (severity === 'fatal' || severity === 'error') return 'ERROR'
    if (severity === 'warning') return 'WARNING'

    return 'INFO'
}

export function operationOutcomeFindings(outcome: OperationOutcome, url: string): Validation[] {
    const issues = outcome.issue ?? []
    if (issues.length === 0) {
        return [
            validation(
                `\`GET ${url}\` returned an OperationOutcome with no issues, which is itself malformed ` +
                    '(OperationOutcome.issue has a minimum cardinality of 1).',
                'ERROR',
                [hl7Refs.httpApi],
            ),
        ]
    }

    return issues.map((issue) => {
        const diagnostics = issue.diagnostics ? `: ${issue.diagnostics}` : ''

        return validation(
            `\`GET ${url}\` returned an OperationOutcome (${issue.severity}/${issue.code})${diagnostics}`,
            issueSeverity(issue.severity),
            [hl7Refs.httpApi],
        )
    })
}

function describeUnexpectedBody(body: unknown): string {
    if (body === null) return 'an empty body'
    if (typeof body === 'string') return 'a non-JSON text body'
    if (typeof body === 'object' && 'resourceType' in body) {
        return `a ${String((body as { resourceType: unknown }).resourceType)} resource`
    }

    return `a body of type ${typeof body}`
}

export type ReadResult<T extends FhirResource> = {
    validations: Validation[]
    resource: T | null
}

export type ReadCheckOptions = {
    url: string
    resourceType: string
    grantedScopes: readonly string[]
}

export function interpretRead<T extends FhirResource>(
    response: RecordedResponse,
    options: ReadCheckOptions,
): ReadResult<T> {
    const { url, resourceType, grantedScopes } = options

    if (response.status === 0) {
        return { validations: [transportFailureFinding(response, url)], resource: null }
    }

    const validations: Validation[] = [
        checkStatusCode(response, {
            url,
            resourceType,
            interaction: 'read',
            grantedScopes,
            expectedStatus: 200,
        }),
        checkContentType(response, url, 'Read'),
    ]

    if (isOperationOutcome(response.body)) {
        validations.push(...operationOutcomeFindings(response.body, url))
        return { validations, resource: null }
    }

    if (
        typeof response.body !== 'object' ||
        response.body === null ||
        (response.body as { resourceType?: unknown }).resourceType !== resourceType
    ) {
        validations.push(
            validation(
                `\`GET ${url}\` did not return a ${resourceType} resource (got ${describeUnexpectedBody(response.body)}).`,
                'ERROR',
                [hl7Refs.httpApi],
            ),
        )
        return { validations, resource: null }
    }

    return { validations, resource: response.body as T }
}

export type SearchResult<T extends FhirResource> = {
    validations: Validation[]
    entries: T[]
    total: number | null
}

export type SearchCheckOptions = {
    url: string
    resourceType: string
    grantedScopes: readonly string[]
    /** True when this search is expected to identify a single resource, e.g. a search by `_id`. */
    expectUnique?: boolean
}

function isMatchEntry(entry: BundleEntry): boolean {
    return (entry.search?.mode ?? 'match') === 'match'
}

function extractSearchsetEntries<T extends FhirResource>(bundle: Bundle, resourceType: string): T[] {
    return (bundle.entry ?? [])
        .filter(isMatchEntry)
        .map((entry) => entry.resource)
        .filter((resource): resource is T => resource !== undefined && resource.resourceType === resourceType)
}

export function interpretSearch<T extends FhirResource>(
    response: RecordedResponse,
    options: SearchCheckOptions,
): SearchResult<T> {
    const { url, resourceType, grantedScopes, expectUnique = false } = options

    if (response.status === 0) {
        return { validations: [transportFailureFinding(response, url)], entries: [], total: null }
    }

    const validations: Validation[] = [
        checkStatusCode(response, {
            url,
            resourceType,
            interaction: 'search',
            grantedScopes,
            expectedStatus: 200,
        }),
        checkContentType(response, url, 'Search'),
    ]

    if (isOperationOutcome(response.body)) {
        validations.push(...operationOutcomeFindings(response.body, url))
        return { validations, entries: [], total: null }
    }

    const body = response.body
    const isSearchsetBundle =
        typeof body === 'object' &&
        body !== null &&
        (body as { resourceType?: unknown }).resourceType === 'Bundle' &&
        (body as { type?: unknown }).type === 'searchset'

    if (!isSearchsetBundle) {
        validations.push(
            validation(
                `\`GET ${url}\` did not return a searchset Bundle (got ${describeUnexpectedBody(body)}); ` +
                    'FHIR R4 requires a Bundle of type `searchset` in response to a search interaction.',
                'ERROR',
                [hl7Refs.search],
            ),
        )
        return { validations, entries: [], total: null }
    }

    const bundle = body as Bundle
    const entries = extractSearchsetEntries<T>(bundle, resourceType)
    const total = typeof bundle.total === 'number' ? bundle.total : entries.length

    validations.push(
        validation(`\`GET ${url}\` returned a searchset Bundle with total ${total}.`, 'OK', [hl7Refs.search]),
    )

    if (expectUnique && total > 1) {
        validations.push(
            validation(
                `\`GET ${url}\` returned ${total} matches, but this search is expected to identify a single ` +
                    'resource from launch context.',
                'WARNING',
                [hl7Refs.search],
            ),
        )
    }

    return { validations, entries, total }
}
