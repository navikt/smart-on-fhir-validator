import type { Encounter } from 'fhir/r4'

import { Validator } from '../../../validation/Validator'
import { hl7Refs, navRefs } from '../../../validation/common-refs'
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
      hl7: hl7Refs.patient,
      nav: navRefs.patient,
    })
  } else if (!encounter.subject.reference.startsWith('Patient/')) {
    validator.error(`Subject reference does not start with "Patient/", but was "${encounter.subject.reference}"`, {
      hl7: hl7Refs.patient,
      nav: navRefs.patient,
    })
  }

  if (!encounter.diagnosis || encounter.diagnosis.length === 0) {
    validator.error('Encounter does not contain any diagnoses', {
      hl7: hl7Refs.condition,
      nav: navRefs.condition,
    })
  } else {
    encounter.diagnosis.forEach((diagnosis) => {
      if (!diagnosis.condition.reference) {
        validator.error('Diagnosis does not contain a condition reference', {
          hl7: hl7Refs.condition,
          nav: navRefs.condition,
        })
      }
      if (!diagnosis.condition.reference?.startsWith('Condition/')) {
        validator.error('Diagnosis condition reference does not start with "Condition/"', {
          hl7: hl7Refs.condition,
          nav: navRefs.condition,
        })
      }
    })
  }

  if (!encounter.participant || encounter.participant.length === 0) {
    validator.error('Encounter does not contain any participants', {
      hl7: hl7Refs.patient,
      nav: navRefs.patient,
    })
  } else {
    encounter.participant.forEach((participant) => {
      if (!participant.individual) {
        validator.error('Participant does not contain an individual', {
          hl7: hl7Refs.patient,
          nav: navRefs.patient,
        })
      } else if (!participant.individual.reference) {
        validator.error('Participant individual reference is not set', {
          hl7: hl7Refs.patient,
          nav: navRefs.patient,
        })
      } else if (!participant.individual.reference.startsWith('Practitioner/')) {
        validator.error('Participant individual reference is not of type Practitioner', {
          hl7: hl7Refs.patient,
          nav: navRefs.patient,
        })
      }
    })
  }

  if (!encounter.serviceProvider?.reference) {
    validator.error('Encounter does not contain a service provider', {
      hl7: hl7Refs.organization,
      nav: navRefs.organization,
    })
  } else if (!encounter.serviceProvider.reference.startsWith('Organization/')) {
    validator.error('Encounter service provider reference does not start with "Organization/"', {
      hl7: hl7Refs.organization,
      nav: navRefs.organization,
    })
  }

  return validator.build()
}
