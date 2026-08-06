/**
 * Organization: reached only by following the `Organization/{id}` reference discovered from
 * `PractitionerRole.organization` (see `practitioner-role.ts`) — never from configuration. When
 * that reference could not be discovered, this probe cannot legally reach an Organization at
 * all and must skip rather than fabricate an id.
 *
 * @see https://hl7.org/fhir/R4/organization.html
 * @see https://github.com/navikt/syk-inn/blob/main/docs/fhir/organization.md
 */

import type { Organization } from 'fhir/r4'

import type { ProbeContext, ProbeOutcome, ResourceProbe } from '#validation/fhir/probe'
import { skipped } from '#validation/fhir/probe'
import { interpretRead } from '#validation/fhir/response'
import type { PractitionerRoleDiscovery } from '#validation/fhir/resources/practitioner-role'
import { hl7Refs, navRefs, simplifierRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import type { Validation } from '#validation/validation'

const ORGANISASJONSNUMMER_OID = 'urn:oid:2.16.578.1.12.4.1.4.101'
const NO_BASIS_ORGANIZATION_PROFILE = 'http://hl7.no/fhir/StructureDefinition/no-basis-Organization'

const refs = {
    hl7: hl7Refs.organization,
    simplifier: simplifierRefs.noBasisOrganization,
    nav: navRefs.organization,
}

export function validateOrganizationResource(organization: Organization): Validation[] {
    const validator = new Validator()

    if (!organization.meta?.profile?.includes(NO_BASIS_ORGANIZATION_PROFILE)) {
        validator.error(
            `Organization/${organization.id} does not declare \`meta.profile\` of ` +
                `\`${NO_BASIS_ORGANIZATION_PROFILE}\`; the no-basis-Organization profile requires it.`,
            refs,
        )
    }

    const hasOrgnr = organization.identifier?.some((id) => id.system === ORGANISASJONSNUMMER_OID) ?? false
    if (!hasOrgnr) {
        validator.error(
            `Organization/${organization.id} has no identifier from the organisasjonsnummer/ENH system ` +
                `\`${ORGANISASJONSNUMMER_OID}\`; Nav uses this to identify the sykmelder's organisation.`,
            refs,
        )
    }

    const phone = organization.telecom?.find((entry) => entry.system === 'phone')
    if (!phone) {
        validator.error(
            `Organization/${organization.id} has no \`telecom\` entry with \`system: phone\`; Nav's ` +
                'saksbehandlere need a phone number to follow up on the sykmelding.',
            { ...refs, simplifier: simplifierRefs.telecom },
        )
    } else if (!phone.value) {
        validator.error(`Organization/${organization.id}.telecom (phone) has no \`value\`.`, {
            ...refs,
            simplifier: simplifierRefs.telecom,
        })
    }

    return validator.build()
}

export function createOrganizationProbe(discovery: PractitionerRoleDiscovery): ResourceProbe {
    const probe: ResourceProbe = {
        id: 'organization',
        label: 'Organization',
        required: true,
        async run(context: ProbeContext): Promise<ProbeOutcome> {
            const { fhir, launch } = context
            const reference = discovery.organizationReference

            if (!reference) {
                return skipped(
                    probe,
                    'No `Organization/{id}` reference could be discovered from a launch-context-derived ' +
                        'query (the PractitionerRole search for the practitioner did not yield one); Nav ' +
                        "cannot resolve the sykmelder's organisation without it.",
                )
            }

            const id = reference.slice('Organization/'.length)
            const readResponse = await fhir.read('Organization', id)
            const { validations: readValidations, resource } = interpretRead<Organization>(readResponse, {
                url: readResponse.exchange.request.url,
                resourceType: 'Organization',
                grantedScopes: launch.grantedScopes,
            })

            const validations: Validation[] = [...readValidations]
            if (resource) validations.push(...validateOrganizationResource(resource))

            return {
                probeId: probe.id,
                label: probe.label,
                exchangeId: readResponse.exchange.id,
                validations,
            }
        },
    }

    return probe
}
