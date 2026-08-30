/**
 * The ordered list of FHIR read probes. Order matters for one dependency: the Organization probe
 * may only reach an Organization via the `Organization/{id}` reference discovered from the
 * PractitionerRole response, never from configuration, so PractitionerRole must run immediately
 * before Organization. That reference is threaded through a private, per-run discovery object.
 * Every other probe derives its query entirely from launch context.
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

/** Fresh probes per call, so a discovered reference never leaks between report runs. */
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

export function runReadProbes(context: ProbeContext): Promise<ProbeOutcome[]> {
    return runProbes(createReadProbes(), context)
}
