import { useQuery } from '@tanstack/react-query'
import type { Patient } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../../utils/ErrorHandler'
import { Validator } from '../../validation/Validator'
import { hl7Refs, simplifierRefs } from '../../validation/common-refs'
import { type Validation, validation } from '../../validation/validation'
import Spinner from '../spinner/Spinner'
import ValidationTable from '../validation-table/ValidationTable'

export interface PatientValidationProps {
  readonly client: Client
}

export default function PatientValidation({ client }: PatientValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['encounterValidation', client.patient.id],
    queryFn: async () => {
      const patient = await client.request<Patient>(`Patient/${client.patient.id}`)

      console.debug('✅ Patient data fetched')
      Object.entries(patient).forEach(([key, value]) => {
        console.debug(`ℹ️ Patient.${key}:`, JSON.stringify(value))
      })

      return patient
    },
  })

  const validations: Validation[] = data ? validatePatient(data) : []

  return (
    <div>
      {isLoading && <Spinner text="Loading Patient data..." />}
      {error ? (
        <ValidationTable validations={[validation(handleError('Unable to fetch Patient', error), 'ERROR')]} />
      ) : (
        <ValidationTable validations={validations} />
      )}
    </div>
  )
}

function validatePatient(fhirPatient: Patient): Validation[] {
  const validator = new Validator()

  const meta = fhirPatient.meta

  if (!meta) {
    validator.error('Patient object does not contain a meta reference', { hl7: hl7Refs.patient })
  } else if (!meta.profile) {
    validator.error('The Patient Meta object does not contain a profile reference', { hl7: hl7Refs.patient })
  } else if (!meta.profile.includes('http://hl7.no/fhir/StructureDefinition/no-basis-Patient')) {
    validator.error('The Patient must be of type no-basis-Patient', {
      simplifier: simplifierRefs.noBasisPasient,
    })
  }

  /**
   * @see https://www.ehelse.no/teknisk-dokumentasjon/oid-identifikatorserier-i-helse-og-omsorgstjenesten#nasjonale-identifikatorserier-for-personer
   */
  const personalIdentifierSystem = 'urn:oid:2.16.578.1.12.4.1.4.1'
  const dNumberSystem = 'urn:oid:2.16.578.1.12.4.1.4.2'

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
