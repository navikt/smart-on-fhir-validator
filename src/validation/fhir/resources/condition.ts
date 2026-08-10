/**
 * Condition: optional for Nav ("Bør", not "Må"), searched by `subject=Patient/{patientId}` and,
 * when an encounter is in context, by `encounter=Encounter/{encounterId}`. `clinical-status` and
 * `category` filtering is not exercised, since condition.md does not require it.
 *
 * @see https://hl7.org/fhir/R4/condition.html
 * @see https://github.com/navikt/syk-inn/blob/main/docs/fhir/condition.md
 */

import type { Condition } from 'fhir/r4'

import type { ProbeContext, ProbeOutcome, ResourceProbe } from '#validation/fhir/probe'
import { skipped } from '#validation/fhir/probe'
import { capSeverity, interpretSearch } from '#validation/fhir/response'
import type { RefTypes } from '#validation/common-refs'
import { hl7Refs, navRefs } from '#validation/common-refs'
import { Validator } from '#validation/Validator'
import { validation, type Validation } from '#validation/validation'

const ICD10_OID = 'urn:oid:2.16.578.1.12.4.1.1.7110'
const ICPC2_OID = 'urn:oid:2.16.578.1.12.4.1.1.7170'
const ICPC2B_OID = 'urn:oid:2.16.578.1.12.4.1.1.7171'
const VALID_CODE_SYSTEMS = [ICD10_OID, ICPC2_OID, ICPC2B_OID]

const refs: RefTypes = [hl7Refs.condition, navRefs.condition]

export function validateConditionResource(conditions: readonly Condition[]): Validation[] {
    const validator = new Validator()

    conditions.forEach((condition) => {
        const reference = condition.subject?.reference
        if (!reference) {
            validator.error(`Condition/${condition.id} has no \`subject\` reference.`, refs)
        } else if (!reference.startsWith('Patient/')) {
            validator.error(
                `Condition/${condition.id}.subject.reference is \`${reference}\`, which does not start ` +
                    'with `Patient/`.',
                refs,
            )
        }

        const codings = condition.code?.coding
        if (!codings || codings.length === 0) {
            validator.error(`Condition/${condition.id} has no \`code.coding\` entries.`, refs)
            return
        }

        const validCodings = codings.filter((coding) => VALID_CODE_SYSTEMS.includes(coding.system ?? ''))
        if (validCodings.length === 0) {
            validator.error(
                `Condition/${condition.id}.code.coding has no entry whose \`system\` is ICD-10 ` +
                    `(\`${ICD10_OID}\`), ICPC-2 (\`${ICPC2_OID}\`) or ICPC-2B (\`${ICPC2B_OID}\`); Nav ` +
                    'cannot pre-fill a diagnosis from an unrecognised code system.',
                refs,
            )
        }

        validCodings.forEach((coding) => {
            if (!coding.code) {
                validator.error(`Condition/${condition.id}.code.coding has an entry with no \`code\`.`, refs)
            }
            if (!coding.display) {
                validator.warn(
                    `Condition/${condition.id}.code.coding has no \`display\` text; Nav shows this to ` +
                        'the clinician alongside the code.',
                    refs,
                )
            }
        })
    })

    return validator.build()
}

export const conditionProbe: ResourceProbe = {
    id: 'condition',
    label: 'Condition',
    required: false,
    async run(context: ProbeContext): Promise<ProbeOutcome> {
        const { fhir, launch } = context

        if (!launch.patientId) {
            return skipped(
                conditionProbe,
                'Launch context has no `patient` id, so Condition cannot be searched by `subject=`.',
            )
        }

        const subjectSearch = await fhir.search('Condition', { subject: `Patient/${launch.patientId}` })
        const subjectResult = interpretSearch<Condition>(subjectSearch, {
            url: subjectSearch.exchange.request.url,
            resourceType: 'Condition',
            grantedScopes: launch.grantedScopes,
        })

        const validations: Validation[] = [...subjectResult.validations]

        if (subjectResult.total === 0) {
            validations.push(
                validation(
                    `\`GET ${subjectSearch.exchange.request.url}\` matched no Condition; this is not an ` +
                        'error since Condition is optional for Nav, but the diagnosis field will be empty.',
                    'INFO',
                    refs,
                ),
            )
        }

        validations.push(...validateConditionResource(subjectResult.entries))

        if (launch.encounterId) {
            const encounterSearch = await fhir.search('Condition', {
                encounter: `Encounter/${launch.encounterId}`,
            })
            const encounterResult = interpretSearch<Condition>(encounterSearch, {
                url: encounterSearch.exchange.request.url,
                resourceType: 'Condition',
                grantedScopes: launch.grantedScopes,
            })
            validations.push(
                ...capSeverity(encounterResult.validations, 'WARNING').map((finding) => ({
                    ...finding,
                    message: `[\`encounter=\` search] ${finding.message}`,
                })),
            )
        }

        return {
            probeId: conditionProbe.id,
            label: conditionProbe.label,
            exchangeId: subjectSearch.exchange.id,
            validations,
        }
    },
}
