import type { Condition } from 'fhir/r4'
import { hl7Refs, navRefs } from 'src/validation/common-refs'

import { Validator } from '../../../validation/Validator'
import type { Validation } from '../../../validation/validation'

const ICD10 = 'urn:oid:2.16.578.1.12.4.1.1.7110'
const ICPC2 = 'urn:oid:2.16.578.1.12.4.1.1.7170'

export function validateCondition(conditions: Condition[]): Validation[] {
  const validator = new Validator()

  conditions.forEach((condition, index) => {
    if (condition.resourceType !== 'Condition') {
      validator.error(`[${index}] Resource is not of type Condition`, {
        hl7: hl7Refs.condition,
        nav: navRefs.condition,
      })
    }
    if (!condition.subject) {
      validator.error(`[${index}] Condition object does not contain a subject reference`, {
        hl7: hl7Refs.condition,
        nav: navRefs.condition,
      })
    } else if (!condition.subject.reference) {
      validator.error(`[${index}] The Condition subject object does not contain a reference`, {
        hl7: hl7Refs.condition,
        nav: navRefs.condition,
      })
    } else if (!condition.subject.reference.includes('Patient')) {
      validator.error(`The Condition subject must be of type Patient, but was "${condition.subject.type}"`, {
        hl7: hl7Refs.condition,
        nav: navRefs.condition,
      })
    }

    if (!condition.code) {
      validator.error(`[${index}] Condition object does not contain a code reference`, {
        hl7: hl7Refs.condition,
        nav: navRefs.condition,
      })
    } else if (!condition.code.coding) {
      validator.error(`[${index}] The Condition code object does not contain a coding reference`, {
        hl7: hl7Refs.condition,
        nav: navRefs.condition,
      })
    } else {
      const validCodings = condition.code.coding.filter((code) => code.system === ICD10 || code.system === ICPC2)

      if (validCodings.length === 0) {
        validator.error(`[${index}] The Condition code object does not contain a valid coding reference`, {
          hl7: hl7Refs.condition,
          nav: navRefs.condition,
        })
      }

      validCodings.forEach((coding) => {
        if (!coding.code) {
          validator.error(`[${index}] The Condition coding object does not contain a code`, {
            hl7: hl7Refs.condition,
            nav: navRefs.condition,
          })
        }
        if (!coding.display) {
          validator.warn('The Condition coding object does not contain a display name', {
            hl7: hl7Refs.condition,
            nav: navRefs.condition,
          })
        }
      })
    }
  })

  return validator.build()
}
