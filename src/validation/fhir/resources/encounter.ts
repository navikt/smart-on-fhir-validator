/**
 * Encounter: searchable by `subject=Patient/{patientId}` (the R4-defined parameter this probe
 * relies on) and, where the EHR also supports it, by `patient=Patient/{patientId}` — R4 defines
 * both. When launch context has an `encounterId`, this probe additionally reads it directly,
 * since that id is itself launch-context-derived and a legal `GET`.
 *
 * @see https://hl7.org/fhir/R4/encounter.html
 * @see https://github.com/navikt/syk-inn/blob/main/docs/fhir/encounter.md
 */

import type { Encounter } from 'fhir/r4'

import type { ProbeContext, ProbeOutcome, ResourceProbe } from '#validation/fhir/probe'
import { skipped } from '#validation/fhir/probe'
import { capSeverity, interpretRead, interpretSearch } from '#validation/fhir/response'
import type { RefTypes } from '#validation/common-refs'
import { hl7Refs, navRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import type { Validation } from '#validation/validation'

const patientRefs: RefTypes = [hl7Refs.patient, navRefs.patient]
const practitionerRefs: RefTypes = [hl7Refs.practitioner, navRefs.practitioner]
const conditionRefs: RefTypes = [hl7Refs.condition, navRefs.condition]
const organizationRefs: RefTypes = [hl7Refs.organization, navRefs.organization]
const encounterRefs: RefTypes = [hl7Refs.encounter, navRefs.encounter]

export function validateEncounterResource(encounter: Encounter): Validation[] {
    const validator = new Validator()

    if (!encounter.subject?.reference) {
        validator.error(
            `Encounter/${encounter.id} has no \`subject\` reference; Nav needs it to identify the ` +
                'patient for this consultation.',
            patientRefs,
        )
    } else if (!encounter.subject.reference.startsWith('Patient/')) {
        validator.error(
            `Encounter/${encounter.id}.subject.reference is \`${encounter.subject.reference}\`, which ` +
                'does not start with `Patient/`.',
            patientRefs,
        )
    }

    if (!encounter.participant || encounter.participant.length === 0) {
        validator.error(
            `Encounter/${encounter.id} has no \`participant\` entries; Nav needs one referencing the ` +
                'sykmelder.',
            practitionerRefs,
        )
    } else {
        encounter.participant.forEach((participant, index) => {
            const reference = participant.individual?.reference
            if (!reference) {
                validator.error(
                    `Encounter/${encounter.id}.participant[${index}] has no \`individual\` reference.`,
                    practitionerRefs,
                )
            } else if (!reference.startsWith('Practitioner/')) {
                validator.error(
                    `Encounter/${encounter.id}.participant[${index}].individual.reference is ` +
                        `\`${reference}\`, which does not start with \`Practitioner/\`.`,
                    practitionerRefs,
                )
            }
        })
    }

    if (!encounter.serviceProvider?.reference) {
        validator.error(
            `Encounter/${encounter.id} has no \`serviceProvider\` reference; Nav needs it to identify ` +
                "the sykmelder's organisation.",
            organizationRefs,
        )
    } else if (!encounter.serviceProvider.reference.startsWith('Organization/')) {
        validator.error(
            `Encounter/${encounter.id}.serviceProvider.reference is ` +
                `\`${encounter.serviceProvider.reference}\`, which does not start with \`Organization/\`.`,
            organizationRefs,
        )
    }

    if (!encounter.diagnosis || encounter.diagnosis.length === 0) {
        validator.warn(
            `Encounter/${encounter.id} has no \`diagnosis\` entries; this is optional but Nav uses it ` +
                'to pre-fill the diagnosis when present.',
            conditionRefs,
        )
    } else {
        encounter.diagnosis.forEach((diagnosis, index) => {
            const reference = diagnosis.condition.reference
            if (!reference) {
                validator.error(
                    `Encounter/${encounter.id}.diagnosis[${index}].condition has no \`reference\`.`,
                    conditionRefs,
                )
            } else if (!reference.startsWith('Condition/')) {
                validator.error(
                    `Encounter/${encounter.id}.diagnosis[${index}].condition.reference is ` +
                        `\`${reference}\`, which does not start with \`Condition/\`.`,
                    conditionRefs,
                )
            }
        })
    }

    if (!encounter.class) {
        validator.warn(
            `Encounter/${encounter.id} has no \`class\`; FHIR R4 requires it, though Nav does not ` +
                'currently use its value.',
            encounterRefs,
        )
    }

    return validator.build()
}

export const encounterProbe: ResourceProbe = {
    id: 'encounter',
    label: 'Encounter',
    required: true,
    async run(context: ProbeContext): Promise<ProbeOutcome> {
        const { fhir, launch } = context

        if (!launch.patientId && !launch.encounterId) {
            return skipped(
                encounterProbe,
                'Launch context has neither a `patient` nor an `encounter` id, so no Encounter can be ' +
                    'reached from launch context alone.',
            )
        }

        const validations: Validation[] = []
        let primaryExchangeId: string | null = null
        let resource: Encounter | null = null

        if (launch.encounterId) {
            const readResponse = await fhir.read('Encounter', launch.encounterId)
            primaryExchangeId = readResponse.exchange.id
            const readResult = interpretRead<Encounter>(readResponse, {
                url: readResponse.exchange.request.url,
                resourceType: 'Encounter',
                grantedScopes: launch.grantedScopes,
            })
            validations.push(...readResult.validations)
            resource = readResult.resource
        }

        if (launch.patientId) {
            const subjectSearch = await fhir.search('Encounter', { subject: `Patient/${launch.patientId}` })
            primaryExchangeId ??= subjectSearch.exchange.id
            const subjectResult = interpretSearch<Encounter>(subjectSearch, {
                url: subjectSearch.exchange.request.url,
                resourceType: 'Encounter',
                grantedScopes: launch.grantedScopes,
            })
            validations.push(...subjectResult.validations)
            resource ??= subjectResult.entries[0] ?? null

            const patientSearch = await fhir.search('Encounter', { patient: `Patient/${launch.patientId}` })
            const patientResult = interpretSearch<Encounter>(patientSearch, {
                url: patientSearch.exchange.request.url,
                resourceType: 'Encounter',
                grantedScopes: launch.grantedScopes,
            })
            validations.push(
                ...capSeverity(patientResult.validations, 'WARNING').map((finding) => ({
                    ...finding,
                    message: `[\`patient=\` search] ${finding.message}`,
                })),
            )
        }

        if (resource) validations.push(...validateEncounterResource(resource))

        return {
            probeId: encounterProbe.id,
            label: encounterProbe.label,
            exchangeId: primaryExchangeId,
            validations,
        }
    },
}
