import type { Bundle, OperationOutcome } from 'fhir/r4'

import { fullRefs, hl7Refs, navRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

/**
 * What Nav actually sends: a `batch` (not `transaction`) Bundle, POSTed to the FHIR server's
 * base URL, where each `entry.request` is a `PUT` to a client-assigned id.
 *
 * ADR01 / bundle.md are explicit about why `batch` and not `transaction`:
 *
 * > `type` er `batch`. I en `batch`-Bundle behandles hver `entry` uavhengig: noen kan lykkes mens
 * > andre feiler. [...] EPJ er pålagt å journalføre sykmeldingen (journalføringsplikten), så
 * > DocumentReference (PDF-en) må alltid lagres, mens QuestionnaireResponse (strukturerte data) er
 * > en nice-to-have. En atomisk `transaction`, der alt rulles tilbake hvis én ressurs feiler, ville
 * > risikert at den lovpålagte DocumentReference ikke ble lagret fordi QuestionnaireResponse
 * > feilet.
 */
export const REQUIRED_BATCH_BUNDLE_TYPE = 'batch'
export const REQUIRED_BATCH_RESPONSE_TYPE = 'batch-response'

/** Validates the `batch` Bundle the probe is about to send, before it goes over the wire. */
export function validateBatchBundleRequest(bundle: Bundle): Validation[] {
    const validator = new Validator()
    const ok: Validation[] = []

    if (bundle.resourceType !== 'Bundle') {
        validator.error(`Resource is not of type Bundle, was "${bundle.resourceType}"`, fullRefs.bundle)
    }

    if (bundle.type !== REQUIRED_BATCH_BUNDLE_TYPE) {
        validator.error(
            `Bundle.type must be "${REQUIRED_BATCH_BUNDLE_TYPE}", was "${bundle.type}". Nav requires "batch" rather than "transaction" so the legally-required DocumentReference is still persisted if the QuestionnaireResponse entry fails (ADR01, journalføringsplikten).`,
            { nav: navRefs.adr01, hl7: hl7Refs.bundle },
        )
    } else {
        ok.push(validation(`Bundle.type is correctly "${REQUIRED_BATCH_BUNDLE_TYPE}"`, 'OK'))
    }

    if (!bundle.entry || bundle.entry.length < 1) {
        validator.error('Bundle does not contain any entries', fullRefs.bundle)
        return [...validator.build(), ...ok]
    }

    bundle.entry.forEach((entry, index) => {
        const label = `entry[${index}]`

        if (!entry.request) {
            validator.error(`Bundle.${label} does not contain a request object with a method and url`, {
                hl7: hl7Refs.bundleTransactionRules,
            })
            return
        }

        if (entry.request.method !== 'PUT') {
            validator.error(
                `Bundle.${label}.request.method should be "PUT", was "${entry.request.method}". Nav sets the resource id itself (the sykmelding id) so each entry is an idempotent upsert rather than a server-assigned create.`,
                { nav: navRefs.adr01, hl7: hl7Refs.bundleTransactionRules },
            )
        } else {
            ok.push(validation(`Bundle.${label}.request.method is correctly "PUT"`, 'OK'))
        }

        if (!entry.request.url) {
            validator.error(`Bundle.${label}.request.url is missing`, { hl7: hl7Refs.bundleTransactionRules })
        } else {
            ok.push(validation(`Bundle.${label}.request.url is "${entry.request.url}"`, 'OK'))
        }

        if (!entry.resource) {
            validator.error(`Bundle.${label} does not contain a resource`, fullRefs.bundle)
        }
    })

    validateInternalReferences(bundle, validator, ok)

    return [...validator.build(), ...ok]
}

/**
 * Checks that references between entries resolve, per
 * https://hl7.org/fhir/R4/http.html#trules.
 *
 * Nav's own batch (see bundle.md) does not use `urn:uuid:` fullUrls: because the sykmelding id is
 * known up front, `fullUrl` and inter-entry references use the plain `<Type>/<id>` form instead.
 * Both forms are legal per R4; this only checks whichever form is actually used.
 */
function validateInternalReferences(bundle: Bundle, validator: Validator, ok: Validation[]): void {
    const entries = bundle.entry ?? []
    const fullUrls = new Set(
        entries.map((entry) => entry.fullUrl).filter((url): url is string => Boolean(url)),
    )

    const referencedIds = entries
        .flatMap((entry) => collectReferences(entry.resource))
        .filter((reference) => reference.startsWith('urn:uuid:') || fullUrls.has(reference))

    const unresolved = referencedIds.filter((reference) => !fullUrls.has(reference))

    if (unresolved.length > 0) {
        validator.error(
            `Bundle contains references that do not resolve to any entry.fullUrl: ${unresolved.join(', ')}`,
            { hl7: hl7Refs.bundleTransactionRules },
        )
    } else if (referencedIds.length > 0) {
        ok.push(
            validation('All internal references between Bundle entries resolve to an entry.fullUrl', 'OK'),
        )
    }
}

function collectReferences(resource: unknown): string[] {
    if (resource == null || typeof resource !== 'object') return []

    const record = resource as Record<string, unknown>
    const references: string[] = []

    if (typeof record.reference === 'string') {
        references.push(record.reference)
    }

    for (const value of Object.values(record)) {
        if (value == null) continue
        if (Array.isArray(value)) {
            references.push(...value.flatMap((entry) => collectReferences(entry)))
        } else if (typeof value === 'object') {
            references.push(...collectReferences(value))
        }
    }

    return references
}

export type BatchEntryOutcome = {
    index: number
    status: string | null
    location: string | null
    operationOutcome: OperationOutcome | null
}

/**
 * Validates the response Bundle to a `batch` submission.
 *
 * Per FHIR R4 (https://hl7.org/fhir/R4/http.html#transaction), a `batch` response must be a
 * `batch-response` Bundle with exactly one entry per request entry, in the same order, each
 * carrying its own `response.status`. Unlike a `transaction`, a failing entry does not fail the
 * whole batch, so each failure must be surfaced individually via its own OperationOutcome rather
 * than one blanket error for the response.
 */
export function validateBatchBundleResponse(
    responseBundle: Bundle | null,
    expectedEntryCount: number,
): Validation[] {
    const validator = new Validator()
    const ok: Validation[] = []

    if (responseBundle == null) {
        validator.error('The batch submission did not return a Bundle to validate', {
            hl7: hl7Refs.bundleTransaction,
        })
        return validator.build()
    }

    if (responseBundle.resourceType !== 'Bundle') {
        validator.error(
            `The response to a batch submission was not a Bundle, was "${responseBundle.resourceType}"`,
            { hl7: hl7Refs.bundleTransaction },
        )
        return validator.build()
    }

    if (responseBundle.type !== REQUIRED_BATCH_RESPONSE_TYPE) {
        validator.error(
            `The response Bundle had type "${responseBundle.type}"; a POST of a "batch" Bundle must return a Bundle of type "${REQUIRED_BATCH_RESPONSE_TYPE}" (FHIR R4 http.html#transaction)`,
            { hl7: hl7Refs.bundleTransaction },
        )
    } else {
        ok.push(validation(`Response Bundle.type is correctly "${REQUIRED_BATCH_RESPONSE_TYPE}"`, 'OK'))
    }

    const entries = responseBundle.entry ?? []

    if (entries.length !== expectedEntryCount) {
        validator.error(
            `The response Bundle contains ${entries.length} entries, expected exactly ${expectedEntryCount} (one per request entry, in the same order)`,
            { hl7: hl7Refs.bundleTransaction },
        )
    } else {
        ok.push(
            validation(
                `Response Bundle contains exactly one entry per request entry (${entries.length})`,
                'OK',
            ),
        )
    }

    entries.forEach((entry, index) => {
        const label = `entry[${index}]`
        if (!entry.response?.status) {
            validator.error(`Response Bundle.${label} does not contain a response.status`, {
                hl7: hl7Refs.bundleTransaction,
            })
            return
        }

        const statusCode = Number.parseInt(entry.response.status, 10)
        if (Number.isNaN(statusCode) || statusCode >= 400) {
            const outcome = entry.response.outcome as OperationOutcome | undefined
            const issueSummary =
                outcome?.issue
                    ?.map((issue) => issue.diagnostics ?? issue.details?.text ?? issue.code)
                    .join('; ') ?? 'no OperationOutcome was included'
            validator.warn(
                `Response Bundle.${label} failed with status "${entry.response.status}": ${issueSummary}. In a "batch", this failure does not affect the other entries.`,
                { hl7: hl7Refs.bundleTransaction },
            )
        } else {
            ok.push(
                validation(`Response Bundle.${label} succeeded with status "${entry.response.status}"`, 'OK'),
            )
        }
    })

    return [...validator.build(), ...ok]
}
