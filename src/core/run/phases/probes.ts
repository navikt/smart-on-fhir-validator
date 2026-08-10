/** Phases 7 and 8: FHIR read and write probes over the resources launch context makes reachable. */

import type { FhirClient } from '#core/fhir/client'
import type { LaunchContext } from '#core/smart/types'
import { runReadProbes } from '#validation/fhir/read-probes'
import { runWriteProbes } from '#validation/fhir/write-probes'

import { sectionFromProbeOutcome, type ReportSection } from '../report'

export async function runReadProbesPhase(fhir: FhirClient, launch: LaunchContext): Promise<ReportSection[]> {
    const outcomes = await runReadProbes({ fhir, launch })
    return outcomes.map((outcome) => sectionFromProbeOutcome(outcome, 'fhir-read'))
}

export async function runWriteProbesPhase(fhir: FhirClient, launch: LaunchContext): Promise<ReportSection[]> {
    const outcomes = await runWriteProbes({ fhir, launch })
    return outcomes.map((outcome) => sectionFromProbeOutcome(outcome, 'fhir-write'))
}
