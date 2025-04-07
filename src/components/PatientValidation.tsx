import { useQuery } from '@tanstack/react-query'
import type { Patient } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../utils/ErrorHandler'
import { Severity, Validation } from '../utils/Validation'

import Spinner from './spinner/Spinner'
import ValidationTable from './validation-table/ValidationTable'

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
        <ValidationTable
          validations={[new Validation(handleError('Unable to fetch Patient', error), Severity.ERROR)]}
        />
      ) : (
        <ValidationTable validations={validations} />
      )}
    </div>
  )
}

function validatePatient(fhirPatient: Patient): Validation[] {
  const newValidations: Validation[] = []

  const meta = fhirPatient.meta

  if (!meta) {
    newValidations.push(new Validation('Patient object does not contain a meta reference', Severity.ERROR))
  } else if (!meta.profile) {
    newValidations.push(new Validation('The Patient Meta object does not contain a profile reference', Severity.ERROR))
  } else if (!meta.profile.includes('http://hl7.no/fhir/StructureDefinition/no-basis-Patient')) {
    newValidations.push(new Validation('The Patient must be of type no-basis-Patient', Severity.ERROR))
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
      newValidations.push(
        new Validation(
          `The Patient does not have a Norwegian national identity number (FNR) from OID "${personalIdentifierSystem}"`,
          Severity.ERROR,
        ),
      )
      newValidations.push(
        new Validation(`The Patient does not have a Norwegian D-number from OID "${dNumberSystem}"`, Severity.ERROR),
      )
    }
  }

  const patientNames = fhirPatient.name
  if (!patientNames || patientNames.length === 0) {
    newValidations.push(new Validation(`The Patient does not have a name property`, Severity.ERROR))
  } else {
    const humanName = patientNames[0]
    if (!humanName.family) {
      newValidations.push(new Validation('The Patient does not have a family name', Severity.ERROR))
    }
    if (!humanName.given || humanName.given.length === 0) {
      newValidations.push(new Validation('The Patient does not have given name(s)', Severity.ERROR))
    }
  }

  return newValidations
}
