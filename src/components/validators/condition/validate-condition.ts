import type { Condition } from 'fhir/r4'

import { Validator } from '../../../validation/Validator'
import type { Validation } from '../../../validation/validation'

export function validateCondition(conditions: Condition[]): Validation[] {
  const validator = new Validator()

  conditions.forEach((condition, index) => {
    if (condition.resourceType !== 'Condition') {
      validator.error(`[${index}] Resource is not of type Condition`)
    }
    if (!condition.subject) {
      validator.error(`[${index}] Condition object does not contain a subject reference`)
    } else if (!condition.subject.reference) {
      validator.error(`[${index}] The Condition subject object does not contain a reference`)
    } else if (!condition.subject.reference.includes('Patient')) {
      validator.error(`The Condition subject must be of type Patient, but was "${condition.subject.type}"`)
    }

    if (!condition.code) {
      validator.error(`[${index}] Condition object does not contain a code reference`)
    } else if (!condition.code.coding) {
      validator.error(`[${index}] The Condition code object does not contain a coding reference`)
    } else {
      const ICD10 = 'urn:oid:2.16.578.1.12.4.1.1.7110'
      const ICPC2 = 'urn:oid:2.16.578.1.12.4.1.1.7170'

      const validCodings = condition.code.coding.filter((code) => code.system === ICD10 || code.system === ICPC2)

      if (validCodings.length === 0) {
        validator.error(`[${index}] The Condition code object does not contain a valid coding reference`)
      }

      validCodings.forEach((coding) => {
        if (!coding.code) {
          validator.error(`[${index}] The Condition coding object does not contain a code`)
        }
        if (!coding.display) {
          validator.warn('The Condition coding object does not contain a display name')
        }
      })
    }
  })

  return validator.build()
}
