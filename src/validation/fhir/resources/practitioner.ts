/**
 * Practitioner: read only, by the id parsed out of the `fhirUser` launch claim.
 *
 * @see https://hl7.org/fhir/R4/practitioner.html
 * @see https://github.com/navikt/syk-inn/blob/main/docs/fhir/practitioner.md
 */

import type { Practitioner } from 'fhir/r4'

import type { ProbeContext, ProbeOutcome, ResourceProbe } from '#validation/fhir/probe'
import { skipped } from '#validation/fhir/probe'
import { interpretRead } from '#validation/fhir/response'
import { hl7Refs, navRefs, simplifierRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import type { Validation } from '#validation/validation'

const HPR_NUMMER_OID = 'urn:oid:2.16.578.1.12.4.1.4.4'
const NO_BASIS_PRACTITIONER_PROFILE = 'http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner'

const refs = {
    hl7: hl7Refs.practitioner,
    simplifier: simplifierRefs.noBasisPractitioner,
    nav: navRefs.practitioner,
}

export function validatePractitionerResource(practitioner: Practitioner): Validation[] {
    const validator = new Validator()

    if (!practitioner.meta?.profile?.includes(NO_BASIS_PRACTITIONER_PROFILE)) {
        validator.error(
            `Practitioner/${practitioner.id} does not declare \`meta.profile\` of ` +
                `\`${NO_BASIS_PRACTITIONER_PROFILE}\`; the no-basis-Practitioner profile requires it.`,
            refs,
        )
    }

    const hasHpr = practitioner.identifier?.some((id) => id.system === HPR_NUMMER_OID) ?? false
    if (!hasHpr) {
        validator.error(
            `Practitioner/${practitioner.id} has no identifier from the Norwegian Health Personnel ` +
                `Register (HPR) system \`${HPR_NUMMER_OID}\`; Nav uses the HPR-nummer to identify the ` +
                'sykmelder.',
            refs,
        )
    }

    return validator.build()
}

export const practitionerProbe: ResourceProbe = {
    id: 'practitioner',
    label: 'Practitioner',
    required: true,
    async run(context: ProbeContext): Promise<ProbeOutcome> {
        const { fhir, launch } = context

        if (!launch.practitionerId) {
            return skipped(
                practitionerProbe,
                `Launch context has no Practitioner id (\`fhirUser\` was ` +
                    `${launch.fhirUser ? `\`${launch.fhirUser}\`, which does not point at a Practitioner` : 'not provided'}); ` +
                    'Nav needs a practitioner id parsed from a Practitioner-typed `fhirUser` claim.',
            )
        }

        const readResponse = await fhir.read('Practitioner', launch.practitionerId)
        const { validations: readValidations, resource } = interpretRead<Practitioner>(readResponse, {
            url: readResponse.exchange.request.url,
            resourceType: 'Practitioner',
            grantedScopes: launch.grantedScopes,
        })

        const validations: Validation[] = [...readValidations]
        if (resource) validations.push(...validatePractitionerResource(resource))

        return {
            probeId: practitionerProbe.id,
            label: practitionerProbe.label,
            exchangeId: readResponse.exchange.id,
            validations,
        }
    },
}
