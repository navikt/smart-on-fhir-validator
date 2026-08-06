import type { Practitioner } from 'fhir/r4'

import { Validator } from '../../../validation/Validator'
import { navRefs, simplifierRefs } from '../../../validation/common-refs'
import type { Validation } from '../../../validation/validation'

const hprSystemIdentifier = 'urn:oid:2.16.578.1.12.4.1.4.4'

export function validatePractitioner(practitioner: Practitioner): Validation[] {
    const validator = new Validator()

    const meta = practitioner.meta

    if (
        !meta ||
        !meta.profile ||
        !meta.profile.includes('http://hl7.no/fhir/StructureDefinition/no-basis-Practitioner')
    ) {
        validator.error('The Practitioner must be of type no-basis-Practitioner', {
            simplifier: simplifierRefs.noBasisPractitioner,
            nav: navRefs.practitioner,
        })
    }

    const norwegianHPRIdentifierSystem = practitioner.identifier?.find(
        (id) => id.system === hprSystemIdentifier,
    )

    if (!norwegianHPRIdentifierSystem) {
        validator.error(
            `The Practitioner does not have a Norwegian Health Personnel Record number (HPR) from OID "${hprSystemIdentifier}"`,
            { nav: navRefs.practitioner },
        )
    }

    return validator.build()
}
