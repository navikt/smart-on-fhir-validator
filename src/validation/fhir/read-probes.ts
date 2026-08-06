/**
 * The ordered list of FHIR read probes: Patient, Practitioner, PractitionerRole, Organization,
 * Encounter, Condition.
 *
 * The order matters for exactly one cross-probe dependency: the Organization probe can only
 * reach an Organization via the `Organization/{id}` reference discovered from the
 * PractitionerRole search's response — never from configuration — so PractitionerRole must run
 * immediately before Organization. `ProbeContext` (owned by `probe.ts`) only carries `fhir` and
 * `launch`, so that discovery is threaded through a private, per-run `PractitionerRoleDiscovery`
 * object captured in closures here rather than by widening `ProbeContext`.
 *
 * Every other probe (Patient, Practitioner, Encounter, Condition) derives its query entirely
 * from `launch` and needs nothing discovered by a probe that ran before it.
 */

import type { ProbeContext, ProbeOutcome, ResourceProbe } from '#validation/fhir/probe'
import { runProbes } from '#validation/fhir/probe'
import { conditionProbe } from '#validation/fhir/resources/condition'
import { encounterProbe } from '#validation/fhir/resources/encounter'
import { createOrganizationProbe } from '#validation/fhir/resources/organization'
import { patientProbe } from '#validation/fhir/resources/patient'
import {
    createPractitionerRoleProbe,
    type PractitionerRoleDiscovery,
} from '#validation/fhir/resources/practitioner-role'
import { practitionerProbe } from '#validation/fhir/resources/practitioner'

/** Builds a fresh set of read probes, so no discovered reference leaks between report runs. */
export function createReadProbes(): ResourceProbe[] {
    const discovery: PractitionerRoleDiscovery = { organizationReference: null }

    return [
        patientProbe,
        practitionerProbe,
        createPractitionerRoleProbe(discovery),
        createOrganizationProbe(discovery),
        encounterProbe,
        conditionProbe,
    ]
}

/** Runs a fresh set of read probes against `context` in the required order. */
export function runReadProbes(context: ProbeContext): Promise<ProbeOutcome[]> {
    return runProbes(createReadProbes(), context)
}
