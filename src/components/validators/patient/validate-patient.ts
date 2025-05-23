import type { Patient } from 'fhir/r4'

import { Validator } from '../../../validation/Validator'
import { navRefs, simplifierRefs } from '../../../validation/common-refs'
import type { Validation } from '../../../validation/validation'

/**
 * @see https://www.ehelse.no/teknisk-dokumentasjon/oid-identifikatorserier-i-helse-og-omsorgstjenesten#nasjonale-identifikatorserier-for-personer
 */
const personalIdentifierSystem = 'urn:oid:2.16.578.1.12.4.1.4.1'
const dNumberSystem = 'urn:oid:2.16.578.1.12.4.1.4.2'

export function validatePatient(fhirPatient: Patient): Validation[] {
  const validator = new Validator()

  const meta = fhirPatient.meta

  if (!meta || !meta.profile || !meta.profile.includes('http://hl7.no/fhir/StructureDefinition/no-basis-Patient')) {
    validator.error('The Patient must be of type no-basis-Patient', {
      simplifier: simplifierRefs.noBasisPasient,
      nav: navRefs.patient,
    })
  }

  const norwegianNationalIdentifierSystem = fhirPatient.identifier?.find((id) => id.system === personalIdentifierSystem)
  const norwegianDNumberSystem = fhirPatient.identifier?.find((id) => id.system === dNumberSystem)

  // If FNR is not present, a D-number is expected. If D-number is present the patient has a valid Norwegian identifier
  if (!norwegianNationalIdentifierSystem) {
    if (!norwegianDNumberSystem) {
      validator.error(
        `The Patient does not have a Norwegian national identity number (FNR) from OID "${personalIdentifierSystem}"`,
      )
      validator.error(`The Patient does not have a Norwegian D-number from OID "${dNumberSystem}"`)
    }
  }

  const patientNames = fhirPatient.name
  if (!patientNames || patientNames.length === 0) {
    validator.error(`The Patient does not have a name property`)
  } else {
    const humanName = patientNames[0]
    if (!humanName.family) {
      validator.error('The Patient does not have a family name')
    }
    if (!humanName.given || humanName.given.length === 0) {
      validator.error('The Patient does not have given name(s)')
    }
  }

  return validator.build()
}
