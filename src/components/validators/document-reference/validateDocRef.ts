import type { DocumentReference } from 'fhir/r4'
import { Validator } from 'src/validation/Validator'

import { hl7Refs, navRefs } from '../../../validation/common-refs'
import { type Validation } from '../../../validation/validation'

const DOCUMENT_TYPE_SYSTEM = 'urn:oid:2.16.578.1.12.4.1.1.9602'
const DOCUMENT_TYPE_CODE = 'J01-2'

export function validateDocumentReference(
  documentReference: DocumentReference | null,
  expectedDocRefId: string | null,
): Validation[] {
  const validator = new Validator()

  if (documentReference == null) {
    validator.error('No document reference found', {
      hl7: hl7Refs.documentReference,
      nav: navRefs.documentReference,
    })
    return validator.build()
  }

  if (documentReference.resourceType !== 'DocumentReference') {
    validator.error('Resource is not of type DocumentReference', {
      hl7: hl7Refs.documentReference,
      nav: navRefs.documentReference,
    })
  }

  if (expectedDocRefId != null && documentReference.id !== expectedDocRefId) {
    validator.error(
      `DocumentReference.id was not the same as the provided ID, was ${documentReference.id ?? 'missing'}, expected ${expectedDocRefId}`,
      {
        hl7: hl7Refs.documentReference,
        nav: navRefs.documentReference,
      },
    )
  }

  if (!documentReference.status) {
    validator.error('DocumentReference does not contain a status object', {
      hl7: hl7Refs.documentReference,
      nav: navRefs.documentReference,
    })
  } else if (documentReference.status !== 'current') {
    validator.error('DocumentReference status must be current', {
      hl7: hl7Refs.documentReference,
      nav: navRefs.documentReference,
    })
  }

  if (!documentReference.category) {
    validator.error('DocumentReference does not contain a category list', {
      hl7: hl7Refs.documentReference,
      nav: navRefs.documentReference,
    })
  } else if (documentReference.category.length < 1) {
    validator.error(
      `DocumentReference category list is empty and requires at least 1 category of type CodeableConcept with the system ${DOCUMENT_TYPE_SYSTEM}`,
      {
        hl7: hl7Refs.documentReference,
        nav: navRefs.documentReference,
      },
    )
  } else {
    const relevantCategory = documentReference.category.find((category) =>
      category.coding?.find((coding) => coding.system === DOCUMENT_TYPE_SYSTEM),
    )

    if (!relevantCategory) {
      validator.error(
        `DocumentReference category list does not contain any category with any Codeableøconcept with system "${DOCUMENT_TYPE_SYSTEM}", but found ${documentReference.category.length ?? 0} other non-relevant categories`,
        { nav: navRefs.documentReference },
      )
    } else {
      const relevantCoding = relevantCategory.coding?.find((it) => it.system === DOCUMENT_TYPE_SYSTEM)
      if (!relevantCoding) {
        validator.error(
          `DocumentReference type object does not contain a coding object with system "${DOCUMENT_TYPE_SYSTEM}"`,
          { nav: navRefs.documentReference },
        )
      } else {
        if (!relevantCoding.display) {
          validator.error('DocumentReference type coding object does not contain a display object', {
            nav: navRefs.documentReference,
          })
        }
        if (!relevantCoding.code) {
          validator.error(
            `DocumentReference type coding object does not contain a system or code object. System was: ${relevantCoding.system} and code was: ${relevantCoding.code}`,
            { nav: navRefs.documentReference },
          )
        } else if (relevantCoding.code !== DOCUMENT_TYPE_CODE) {
          validator.error(
            `DocumentReference type code must be "${DOCUMENT_TYPE_CODE}", but was "${relevantCoding.code}"`,
            { nav: navRefs.documentReference },
          )
        }
      }
    }
  }

  if (!documentReference.subject) {
    validator.error('DocumentReference does not contain a subject object')
  } else {
    if (!documentReference.subject.reference) {
      validator.error('DocumentReference subject object does not contain a reference')
    }
  }

  if (!documentReference.author) {
    validator.error('DocumentReference does not contain an author object')
  } else {
    documentReference.author.forEach((author) => {
      if (!author.reference) {
        validator.error(
          'DocumentReference author object does not contain a reference to the Practitioner who authorized the document',
        )
      }
    })
  }
  if (!documentReference.content) {
    validator.error('DocumentReference does not contain a content object')
  } else {
    documentReference.content.forEach((content) => {
      if (!content.attachment) {
        validator.error('DocumentReference content object does not contain an attachment object')
        return
      }
      if (!content.attachment.title) {
        validator.error('DocumentReference content attachment object does not contain a title')
      }
      if (!content.attachment.data && !content.attachment.url) {
        validator.error(
          `DocumentReference content attachment object does not contain a "data" or "url" object. DocumentReference must either have a b64-encoded PDF in the data field, or a reference to a Binary on the FHIR-server in the url field, i.e: "Binary/<reference>"`,
        )
      } else if (content.attachment.url) {
        validator.info(
          'DocumentReference content attachment object contains "url" with a reference to a binary file on the FHIR-server - all good"',
        )
      }
      if (!content.attachment.contentType && !content.attachment.url) {
        validator.error(
          'DocumentReference content attachment object does not contain the contentType object, should be "application/pdf. This is required when sending b64 encoded files in the "data" object. "',
        )
      } else if (content.attachment.data && content.attachment.contentType === 'application/pdf') {
        validator.info('DocumentReference content attachment object contains "data" with b64 encoded PDF - all good"')
      }
      if (!content.attachment.language) {
        validator.error('DocumentReference content attachment object does not contain a language object')
      }
    })
  }

  if (!documentReference.context) {
    validator.error('DocumentReference does not contain a context object')
  } else if (!documentReference.context.encounter) {
    validator.error('DocumentReference context object does not contain an encounter object')
  }

  return validator.build()
}
