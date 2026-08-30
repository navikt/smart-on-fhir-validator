import type { FhirClient } from '#core/fhir/client'
import type { LaunchContext } from '#core/smart/types'
import type { Validation } from '#validation/validation'

/**
 * Deliberately minimal: a probe may only use identifiers the EHR itself handed over in the launch
 * context, never configured ones.
 */
export type ProbeContext = {
    fhir: FhirClient
    launch: LaunchContext
}

export type ProbeOutcome = {
    probeId: string
    label: string
    /** The exchange the report shows as evidence for this probe's findings. */
    exchangeId: string | null
    /** Set when the probe could not run at all, e.g. launch context lacked an encounter. */
    skipped?: { reason: string }
    validations: Validation[]
}

/**
 * A single, self-contained check against the EHR's FHIR server. Probes never throw: a
 * non-conformant EHR is the expected case, and must be reported as findings rather than crash.
 */
export type ResourceProbe = {
    id: string
    label: string
    /** Nav cannot pre-fill a sykmelding without this resource, so failure is an ERROR. */
    required: boolean
    run(context: ProbeContext): Promise<ProbeOutcome>
}

export function skipped(probe: ResourceProbe, reason: string): ProbeOutcome {
    return { probeId: probe.id, label: probe.label, exchangeId: null, skipped: { reason }, validations: [] }
}

/** Sequential, so recorded exchanges appear in the report in the order they were made. */
export async function runProbes(probes: ResourceProbe[], context: ProbeContext): Promise<ProbeOutcome[]> {
    const outcomes: ProbeOutcome[] = []
    for (const probe of probes) {
        outcomes.push(await probe.run(context))
    }
    return outcomes
}
