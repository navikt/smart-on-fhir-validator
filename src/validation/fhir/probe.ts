import type { FhirClient } from '#core/fhir/client'
import type { LaunchContext } from '#core/smart/types'
import type { Validation } from '#validation/validation'

/**
 * What a probe needs in order to run. Nothing else is available to it on purpose: a probe may
 * only use identifiers that the EHR itself handed over in the launch context.
 */
export type ProbeContext = {
    fhir: FhirClient
    launch: LaunchContext
}

export type ProbeOutcome = {
    probeId: string
    /** Short human label, e.g. "Patient by launch context". */
    label: string
    /** The exchange that produced the evidence, so the report can show the raw call. */
    exchangeId: string | null
    /** Set when the probe could not run at all, e.g. the launch context lacked an encounter. */
    skipped?: { reason: string }
    validations: Validation[]
}

/**
 * A single, self-contained check against the EHR's FHIR server.
 *
 * Probes are the unit of work of the report: each one issues at most a handful of calls and
 * turns the result into findings. They never throw — a failing EHR is the expected case.
 */
export type ResourceProbe = {
    id: string
    label: string
    /**
     * Nav cannot pre-fill a sykmelding without this resource, so a failure here is an ERROR
     * rather than a warning.
     */
    required: boolean
    run(context: ProbeContext): Promise<ProbeOutcome>
}

export function skipped(probe: ResourceProbe, reason: string): ProbeOutcome {
    return { probeId: probe.id, label: probe.label, exchangeId: null, skipped: { reason }, validations: [] }
}

/** Runs probes sequentially so the recorded exchanges appear in the order a vendor would expect. */
export async function runProbes(probes: ResourceProbe[], context: ProbeContext): Promise<ProbeOutcome[]> {
    const outcomes: ProbeOutcome[] = []
    for (const probe of probes) {
        outcomes.push(await probe.run(context))
    }
    return outcomes
}
