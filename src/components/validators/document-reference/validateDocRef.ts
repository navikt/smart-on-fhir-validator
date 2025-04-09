import type { DocumentReference } from 'fhir/r4'
import { Validator } from 'src/validation/Validator'

import { type Validation } from '../../../validation/validation'

export function validateDocumentReference(documentReference: DocumentReference | null): Validation[] {
  const validator = new Validator()

  if (documentReference == null) {
    validator.error('No document reference found')
    return validator.build()
  }

  if (documentReference.resourceType !== 'DocumentReference') {
    validator.error('Resource is not of type DocumentReference')
  }

  if (!documentReference.status) {
    validator.error('DocumentReference does not contain a status object')
  } else if (documentReference.status !== 'current') {
    validator.error('DocumentReference status must be current')
  }

  if (!documentReference.type) {
    validator.error('DocumentReference does not contain a type object')
  } else if (!documentReference.type.coding) {
    validator.error('DocumentReference type object does not contain a coding object')
  } else {
    documentReference.type.coding.forEach((coding) => {
      if (!coding.display) {
        validator.error('DocumentReference type coding object does not contain a display object')
      }
      if (!coding.system || !coding.code) {
        validator.error(
          `DocumentReference type coding object does not contain a system or code object. System was: ${coding.system} and code was: ${coding.code}`,
        )
      } else if (coding.system !== 'urn:oid:2.16.578.1.12.4.1.1.9602' || coding.code !== 'J01-2') {
        validator.error(
          `DocumentReference type coding system must be "urn:oid:2.16.578.1.12.4.1.1.9602" and code must be ""J01-2", but was "${coding.system}" and "${coding.code}"`,
        )
      }
    })
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
