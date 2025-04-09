import { useQuery } from '@tanstack/react-query'
import type { Practitioner } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { handleError } from '../../utils/ErrorHandler'
import { hl7Refs, navRefs, simplifierRefs } from '../../validation/common-refs'
import { type Validation, validation } from '../../validation/validation'
import Spinner from '../spinner/Spinner'
import ValidationTable from '../validation-table/ValidationTable'

const hprSystemIdentifier = 'urn:oid:2.16.578.1.12.4.1.4.4'
const herSystemIdentifier = 'urn:oid:2.16.578.1.12.4.1.2'

export interface PractitionerValidationProps {
  readonly client: Client
}

export default function PractitionerValidation({ client }: PractitionerValidationProps) {
  const { error, data, isLoading } = useQuery({
    queryKey: ['encounterValidation', client.user.fhirUser],
    queryFn: async () => {
      if (client.user.fhirUser == null) {
        throw new Error('ID-token missing the fhirUser claim. ')
      }
      if (client.getUserType() !== 'Practitioner') {
        throw new Error(`ID-token fhirUser must be Practitioner, but was "${client.getUserType()}" `)
      }
      const practitioner = await client.request<Practitioner>(client.user.fhirUser)
      console.debug('✅ Practitioner data fetched')
      Object.entries(practitioner).forEach(([key, value]) => {
        console.debug(`ℹ️ Practitioner.${key}:`, value)
      })
      return practitioner
    },
  })

  const validations: Validation[] = data ? validatePractitioner(data) : []

  return (
    <div>
      {isLoading && <Spinner text="Loading Practitioner data..." />}
      {error ? (
        <ValidationTable validations={[validation(handleError('Unable to fetch Practitioner', error), 'ERROR')]} />
      ) : (
        <ValidationTable validations={validations} />
      )}
    </div>
  )
}

function validatePractitioner(practitioner: Practitioner): Validation[] {
  const newValidations: Validation[] = []

  const meta = practitioner.meta

  if (!meta) {
    newValidations.push(
      validation('Practitioner object does not contain a meta reference', 'ERROR', {
        hl7: hl7Refs.practitioner,
      }),
    )
  } else if (!meta.profile) {
    newValidations.push(
      validation('The Practitioner Meta object does not contain a profile reference', 'ERROR', {
        hl7: hl7Refs.practitioner,
      }),
    )
  } else if (!meta.profile.includes('http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner')) {
    newValidations.push(
      validation('The Practitioner must be of type no-basis-Practitioner', 'ERROR', {
        simplifier: simplifierRefs.noBasisPractitioner,
        nav: navRefs.practitioner,
      }),
    )
  }

  const norwegianHPRIdentifierSystem = practitioner.identifier?.find((id) => id.system === hprSystemIdentifier)
  const norwegianHERIdentifierSystem = practitioner.identifier?.find((id) => id.system === herSystemIdentifier)

  if (!norwegianHPRIdentifierSystem) {
    newValidations.push(
      validation(
        `The Practitioner does not have a Norwegian Health Personnel Record number (HPR) from OID "${hprSystemIdentifier}"`,
        'ERROR',
      ),
    )
  } else if (!norwegianHERIdentifierSystem) {
    newValidations.push(
      validation(`The Practitioner does not have a Norwegian HER-id from OID "${hprSystemIdentifier}"`, 'INFO'),
    )
  }

  const practitionerName = practitioner.name
  if (!practitionerName || practitionerName.length === 0) {
    newValidations.push(validation(`The Practitioner does not have a name property`, 'ERROR'))
  } else {
    const humanName = practitionerName[0]
    if (!humanName.family) {
      newValidations.push(validation('The Practitioner does not have a family name', 'ERROR'))
    }
    if (!humanName.given || humanName.given.length === 0) {
      newValidations.push(validation('The Practitioner does not have given name(s)', 'ERROR'))
    }
  }

  const practitionerTelecom = practitioner.telecom
  if (!practitionerTelecom || practitionerTelecom.length === 0) {
    newValidations.push(
      validation(`The Practitioner does not have a telecom property`, 'ERROR', {
        simplifier: telecomSimplifierLink,
      }),
    )
  } else {
    practitionerTelecom.forEach((telecom, index) => {
      if (!telecom.system || !['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other'].includes(telecom.system)) {
        newValidations.push(
          validation(
            `The Practitioner content [${index}] does not have a telecom system: ${telecom.system ?? 'undefined'} `,
            'ERROR',
            { simplifier: telecomSimplifierLink },
          ),
        )
      }
      if (!telecom.value) {
        newValidations.push(validation(`The Practitioner content [${index}] does not have a telecom value`, 'ERROR'))
      }
      if (!telecom.use || !['home', 'work', 'temp', 'old', 'mobile'].includes(telecom.use)) {
        newValidations.push(
          validation(
            `The Practitioner content [${index}] does not have a telecom use: "${telecom.use ?? 'undefined'}"`,
            'WARNING',
            { simplifier: telecomSimplifierLink, nav: navRefs.practitioner },
          ),
        )
      }
    })
  }

  return newValidations
}

const telecomSimplifierLink = 'https://simplifier.net/packages/hl7.fhir.r4.core/4.0.1/files/83048'
