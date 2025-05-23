import type { Organization } from 'fhir/r4'

import { Validator } from '../../../validation/Validator'
import { navRefs, simplifierRefs } from '../../../validation/common-refs'
import type { Validation } from '../../../validation/validation'

const ENH_IDENTIFIER_SYSTEM = 'urn:oid:2.16.578.1.12.4.1.4.101'

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
    const identifier = organization.identifier?.find((id) => id.system === ENH_IDENTIFIER_SYSTEM)
    if (!identifier) {
      validator.error(
        `[${index}] The organization does not have an identifier of type ENH (oid: ${ENH_IDENTIFIER_SYSTEM})`,
        {
          nav: navRefs.organization,
        },
      )
    }
    if (!organization.name) {
      validator.error(`[${index}] Organization.name is required`)
    }
    organization.telecom?.forEach((telecom, telecomIndex) => {
      if (!telecom.system) {
        validator.error(`[${index}].telecom[${telecomIndex}].system is required`, {
          simplifier: simplifierRefs.telecom,
          nav: navRefs.organization,
        })
      }
      if (!telecom.value) {
        validator.error(`[${index}].telecom[${telecomIndex}].value is required`, {
          simplifier: simplifierRefs.telecom,
          nav: navRefs.organization,
        })
      }
    })
  })

  return validator.build()
}
