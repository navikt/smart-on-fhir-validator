import type { Organization } from 'fhir/r4'

import { Validator } from '../../../validation/Validator'
import { navRefs, simplifierRefs } from '../../../validation/common-refs'
import type { Validation } from '../../../validation/validation'

const ENH_IDENTIFIER_SYSTEM = 'urn:oid:2.16.578.1.12.4.1.4.101'
const HER_IDENTIFIER_SYSTEM = 'urn:oid:2.16.578.1.12.4.1.2'

export function validateOrganization(fhirOrganizations: Organization[]): Validation[] {
  const validator = new Validator()

  fhirOrganizations.forEach((organization, index) => {
    const meta = organization.meta
    if (
      !meta ||
      !meta.profile ||
      !meta.profile.includes('http://hl7.no/fhir/StructureDefinition/no-basis-Organization')
    ) {
      validator.error('The Organization must be of type no-basis-Organization', {
        simplifier: simplifierRefs.noBasisOrganization,
        nav: navRefs.organization,
      })
    }

    if (organization.resourceType !== 'Organization') {
      validator.error(`[${index}] Resource is not of type Organization`)
    }

    const enhIdentifier = organization.identifier?.find((id) => id.system === ENH_IDENTIFIER_SYSTEM)
    if (!enhIdentifier) {
      validator.error(
        `[${index}] The organization does not have an identifier of type ENH (oid: ${ENH_IDENTIFIER_SYSTEM})`,
        {
          nav: navRefs.organization,
        },
      )
    }

    const herIdentifier = organization.identifier?.find((id) => id.system === HER_IDENTIFIER_SYSTEM)
    if (!herIdentifier) {
      validator.warn(
        `[${index}] The organization does not have an identifier of type HER (oid: ${HER_IDENTIFIER_SYSTEM})`,
        {
          nav: navRefs.organization,
        },
      )
    }

    const phoneNumber = organization.telecom?.find((telecom) => telecom.system === 'phone')
    if (!phoneNumber) {
      validator.error(`[${index}] The organization does not have a phone number`, {
        simplifier: simplifierRefs.telecom,
        nav: navRefs.organization,
      })
    } else {
      if (!phoneNumber.value) {
        validator.error(`[${index}].telecom.value is required`, {
          simplifier: simplifierRefs.telecom,
          nav: navRefs.organization,
        })
      }
    }
  })

  return validator.build()
}
