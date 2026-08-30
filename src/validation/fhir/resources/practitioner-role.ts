/**
 * PractitionerRole: searchable by `practitioner=Practitioner/{id}`. This is how the clinician's
 * organisation (and HPR/legekontor affiliation) is resolved: `PractitionerRole.organization`
 * is the reference the Organization probe reads from.
 *
 * @see https://hl7.org/fhir/R4/practitionerrole.html
 * @see https://github.com/navikt/syk-inn/blob/main/docs/fhir/nav-requirements.md
 */

import type { PractitionerRole } from 'fhir/r4'

import type { ProbeContext, ProbeOutcome, ResourceProbe } from '#validation/fhir/probe'
import { skipped } from '#validation/fhir/probe'
import { interpretSearch } from '#validation/fhir/response'
import type { RefTypes } from '#validation/common-refs'
import { hl7Refs, navRefs, simplifierRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import type { Validation } from '#validation/validation'

const NO_BASIS_PRACTITIONER_ROLE_PROFILE = 'http://hl7.no/fhir/StructureDefinition/no-basis-PractitionerRole'

const refs: RefTypes = [
    hl7Refs.practitionerRole,
    simplifierRefs.noBasisPractitionerRole,
    navRefs.practitionerRole,
]

export function validatePractitionerRoleResource(role: PractitionerRole): Validation[] {
    const validator = new Validator()

    if (!role.meta?.profile?.includes(NO_BASIS_PRACTITIONER_ROLE_PROFILE)) {
        validator.error(
            `PractitionerRole/${role.id} does not declare \`meta.profile\` of ` +
                `\`${NO_BASIS_PRACTITIONER_ROLE_PROFILE}\`; the no-basis-PractitionerRole profile requires it.`,
            refs,
        )
    }

    if (!role.practitioner?.reference) {
        validator.error(
            `PractitionerRole/${role.id} has no \`practitioner\` reference; Nav cannot link this role ` +
                'back to the sykmelder.',
            refs,
        )
    } else if (!role.practitioner.reference.startsWith('Practitioner/')) {
        validator.error(
            `PractitionerRole/${role.id}.practitioner.reference is \`${role.practitioner.reference}\`, ` +
                'which does not start with `Practitioner/`.',
            refs,
        )
    }

    if (!role.organization?.reference) {
        validator.error(
            `PractitionerRole/${role.id} has no \`organization\` reference; Nav needs this to resolve ` +
                "the sykmelder's legekontor/organisation.",
            refs,
        )
    } else if (!role.organization.reference.startsWith('Organization/')) {
        validator.error(
            `PractitionerRole/${role.id}.organization.reference is \`${role.organization.reference}\`, ` +
                'which does not start with `Organization/`.',
            refs,
        )
    }

    return validator.build()
}

export function firstOrganizationReference(roles: readonly PractitionerRole[]): string | null {
    for (const role of roles) {
        if (role.organization?.reference?.startsWith('Organization/')) return role.organization.reference
    }

    return null
}

export type PractitionerRoleDiscovery = {
    /** Populated by `run()`, so the Organization probe can follow the reference afterwards. */
    organizationReference: string | null
}

/**
 * Factory rather than a shared constant: `read-probes.ts` supplies a fresh, private discovery
 * object per report run, so the Organization probe (which runs right after) picks up the
 * reference this run discovered and never one from a previous run.
 */
export function createPractitionerRoleProbe(discovery: PractitionerRoleDiscovery): ResourceProbe {
    const probe: ResourceProbe = {
        id: 'practitioner-role',
        label: 'PractitionerRole',
        required: true,
        async run(context: ProbeContext): Promise<ProbeOutcome> {
            const { fhir, launch } = context

            if (!launch.practitionerId) {
                return skipped(
                    probe,
                    'Launch context has no Practitioner id, so PractitionerRole cannot be searched by ' +
                        '`practitioner=`.',
                )
            }

            const searchResponse = await fhir.search('PractitionerRole', {
                practitioner: `Practitioner/${launch.practitionerId}`,
            })
            const { validations: searchValidations, entries } = interpretSearch<PractitionerRole>(
                searchResponse,
                {
                    url: searchResponse.exchange.request.url,
                    resourceType: 'PractitionerRole',
                    grantedScopes: launch.grantedScopes,
                },
            )

            const validations: Validation[] = [...searchValidations]

            if (entries.length === 0) {
                validations.push({
                    message:
                        `\`GET ${searchResponse.exchange.request.url}\` matched no PractitionerRole; Nav ` +
                        "cannot resolve the sykmelder's organisation without one.",
                    severity: 'ERROR',
                    refs,
                })
            }

            for (const role of entries) validations.push(...validatePractitionerRoleResource(role))

            discovery.organizationReference = firstOrganizationReference(entries)

            return {
                probeId: probe.id,
                label: probe.label,
                exchangeId: searchResponse.exchange.id,
                validations,
            }
        },
    }

    return probe
}
