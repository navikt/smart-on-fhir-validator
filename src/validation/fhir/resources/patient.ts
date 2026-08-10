/**
 * Patient: read, plus a supplementary `_id` search where the EHR supports it.
 *
 * @see https://hl7.org/fhir/R4/patient.html
 * @see https://github.com/navikt/syk-inn/blob/main/docs/fhir/patient.md
 */

import type { Patient } from 'fhir/r4'

import type { ProbeContext, ProbeOutcome, ResourceProbe } from '#validation/fhir/probe'
import { skipped } from '#validation/fhir/probe'
import { capSeverity, interpretRead, interpretSearch } from '#validation/fhir/response'
import type { RefTypes } from '#validation/common-refs'
import { hl7Refs, navRefs, simplifierRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import type { Validation } from '#validation/validation'

/**
 * @see https://www.ehelse.no/teknisk-dokumentasjon/oid-identifikatorserier-i-helse-og-omsorgstjenesten
 */
const FODSELSNUMMER_OID = 'urn:oid:2.16.578.1.12.4.1.4.1'
const D_NUMMER_OID = 'urn:oid:2.16.578.1.12.4.1.4.2'
const NO_BASIS_PATIENT_PROFILE = 'http://hl7.no/fhir/StructureDefinition/no-basis-Patient'

const refs: RefTypes = [hl7Refs.patient, simplifierRefs.noBasisPasient, navRefs.patient]

/** Conformance check against no-basis-Patient and Nav's identification requirements. */
export function validatePatientResource(patient: Patient): Validation[] {
    const validator = new Validator()

    if (!patient.meta?.profile?.includes(NO_BASIS_PATIENT_PROFILE)) {
        validator.error(
            `Patient/${patient.id} does not declare \`meta.profile\` of \`${NO_BASIS_PATIENT_PROFILE}\`; ` +
                'the no-basis-Patient profile requires it.',
            refs,
        )
    }

    const hasFnr = patient.identifier?.some((id) => id.system === FODSELSNUMMER_OID) ?? false
    const hasDNumber = patient.identifier?.some((id) => id.system === D_NUMMER_OID) ?? false

    if (!hasFnr && !hasDNumber) {
        validator.error(
            `Patient/${patient.id} has no identifier from the Norwegian national identity number ` +
                `system \`${FODSELSNUMMER_OID}\` and no D-number from \`${D_NUMMER_OID}\`; Nav cannot ` +
                'identify the patient without one of these.',
            refs,
        )
    }

    const name = patient.name?.[0]
    if (!name) {
        validator.error(
            `Patient/${patient.id} has no \`name\` entry; Nav shows this to the clinician to confirm the ` +
                'sykmelding is being written for the correct patient.',
            refs,
        )
    } else {
        if (!name.family) {
            validator.error(`Patient/${patient.id}.name[0] has no \`family\` name.`, refs)
        }
        if (!name.given || name.given.length === 0) {
            validator.error(`Patient/${patient.id}.name[0] has no \`given\` name(s).`, refs)
        }
    }

    return validator.build()
}

export const patientProbe: ResourceProbe = {
    id: 'patient',
    label: 'Patient',
    required: true,
    async run(context: ProbeContext): Promise<ProbeOutcome> {
        const { fhir, launch } = context

        if (!launch.patientId) {
            return skipped(
                patientProbe,
                'Launch context has no `patient` id; the token response did not include one, so no ' +
                    'Patient probe can run.',
            )
        }

        const readResponse = await fhir.read('Patient', launch.patientId)
        const readUrl = readResponse.exchange.request.url
        const { validations: readValidations, resource } = interpretRead<Patient>(readResponse, {
            url: readUrl,
            resourceType: 'Patient',
            grantedScopes: launch.grantedScopes,
        })

        const validations: Validation[] = [...readValidations]
        if (resource) validations.push(...validatePatientResource(resource))

        const searchResponse = await fhir.search('Patient', { _id: launch.patientId })
        const { validations: searchValidations } = interpretSearch<Patient>(searchResponse, {
            url: searchResponse.exchange.request.url,
            resourceType: 'Patient',
            grantedScopes: launch.grantedScopes,
            expectUnique: true,
        })
        validations.push(
            ...capSeverity(searchValidations, 'WARNING').map((finding) => ({
                ...finding,
                message: `[supplementary search] ${finding.message}`,
            })),
        )

        return {
            probeId: patientProbe.id,
            label: patientProbe.label,
            exchangeId: readResponse.exchange.id,
            validations,
        }
    },
}
