import type { Encounter } from 'fhir/r4'

import { Validator } from '../../../validation/Validator'
import { navRefs } from '../../../validation/common-refs'
import type { Validation } from '../../../validation/validation'

export function validateEncounter(encounter: Encounter): Validation[] {
  const validator = new Validator()

  if (encounter.resourceType !== 'Encounter') {
    validator.error('Resource is not of type Encounter')
  }

  /* TODO: Ta avgjørnelse på hvilket kodeverk vi skal bruke
  if (!encounter.class || encounter.class.system !== 'http://terminology.hl7.org/CodeSystem/v3-ActCode') {
    validator.error('Class system is not http://terminology.hl7.org/CodeSystem/v3-ActCode')
  }

  if (!encounter.class || !encounter.class.code) {
    validator.error('class object is missing code')
  } else if (!['AMB', 'VR'].includes(encounter.class.code)) {
    validator.error(`Class object code must be AMB, VR, but was "${encounter.class.code}"`)
  }
   */

  if (!encounter.subject?.reference) {
    validator.error(`Subject object does not contain a subject (type: Patient/<id>)`, {
      hl7: navRefs.patient,
      nav: navRefs.patient,
    })
  } else if (!encounter.subject.reference.startsWith('Patient/')) {
    validator.error(`Subject reference does not start with "Patient/", but was "${encounter.subject.reference}"`, {
      hl7: navRefs.patient,
      nav: navRefs.patient,
    })
  }

  if (!encounter.participant || encounter.participant.length === 0) {
    validator.error('Encounter does not contain any participants', {
      hl7: navRefs.patient,
      nav: navRefs.patient,
    })
  } else {
    encounter.participant.forEach((participant) => {
      if (!participant.individual) {
        validator.error('Participant does not contain an individual', {
          hl7: navRefs.patient,
          nav: navRefs.patient,
        })
      } else if (!participant.individual.reference) {
        validator.error('Participant individual reference is not set', {
          hl7: navRefs.patient,
          nav: navRefs.patient,
        })
      } else if (!participant.individual.reference.includes('Practitioner')) {
        validator.error('Participant individual reference is not of type Practitioner', {
          hl7: navRefs.patient,
          nav: navRefs.patient,
        })
      }
    })
  }

  if (!encounter.period) {
    validator.error('Encounter does not contain a period', {
      hl7: navRefs.patient,
      nav: navRefs.patient,
    })
  } else if (!encounter.period.start) {
    validator.error('Encounter period does not contain a start date', {
      hl7: navRefs.patient,
      nav: navRefs.patient,
    })
  }

  /* TODO: Ta avgjørelse på diagonesformat
  if (!encounter.diagnosis || encounter.diagnosis.length === 0) {
    validator.error('Encounter does not contain any diagnosis')
  } else {
    encounter.diagnosis.forEach((diagnosis) => {
      if (!diagnosis.condition) {
        validator.error('Diagnosis does not contain a condition')
      } else if (diagnosis.condition.type !== 'Condition') {
        validator.error(`Diagnosis condition type is not set to "Condition", but was: ${diagnosis.condition.type}`)
      } else if (!diagnosis.condition.reference) {
        validator.error('Diagnosis condition reference is not set')
      } else if (!diagnosis.condition.reference.includes('Condition')) {
        validator.error('Diagnosis condition reference is not of type Condition')
      }
    })
  }
  */

  return validator.build()
}