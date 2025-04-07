import type { DocumentReference } from 'fhir/r4'

import { Severity, Validation } from '../utils/Validation'

export function validateDocumentReference(documentReference: DocumentReference | null): Validation[] {
  const newValidations: Validation[] = []

  if (documentReference == null) {
    newValidations.push(new Validation('No document reference found', Severity.ERROR))
    return newValidations
  }

  if (documentReference.resourceType !== 'DocumentReference') {
    newValidations.push(new Validation('Resource is not of type DocumentReference', Severity.ERROR))
  }

  if (!documentReference.status) {
    newValidations.push(new Validation('DocumentReference does not contain a status object', Severity.ERROR))
  } else if (documentReference.status !== 'current') {
    newValidations.push(new Validation('DocumentReference status must be current', Severity.ERROR))
  }

  if (!documentReference.type) {
    newValidations.push(new Validation('DocumentReference does not contain a type object', Severity.ERROR))
  } else if (!documentReference.type.coding) {
    newValidations.push(
      new Validation('DocumentReference type object does not contain a coding object', Severity.ERROR),
    )
  } else {
    documentReference.type.coding.forEach((coding) => {
      if (!coding.display) {
        newValidations.push(
          new Validation('DocumentReference type coding object does not contain a display object', Severity.ERROR),
        )
      }
      if (!coding.system || !coding.code) {
        newValidations.push(
          new Validation(
            `DocumentReference type coding object does not contain a system or code object. System was: ${coding.system} and code was: ${coding.code}`,
            Severity.ERROR,
          ),
        )
      } else if (coding.system !== 'urn:oid:2.16.578.1.12.4.1.1.9602' || coding.code !== 'J01-2') {
        newValidations.push(
          new Validation(
            `DocumentReference type coding system must be "urn:oid:2.16.578.1.12.4.1.1.9602" and code must be ""J01-2", but was "${coding.system}" and "${coding.code}"`,
            Severity.ERROR,
          ),
        )
      }
    })
  }

  if (!documentReference.subject) {
    newValidations.push(new Validation('DocumentReference does not contain a subject object', Severity.ERROR))
  } else {
    if (!documentReference.subject.reference) {
      newValidations.push(
        new Validation('DocumentReference subject object does not contain a reference', Severity.ERROR),
      )
    }
  }

  if (!documentReference.author) {
    newValidations.push(new Validation('DocumentReference does not contain an author object', Severity.ERROR))
  } else {
    documentReference.author.forEach((author) => {
      if (!author.reference) {
        newValidations.push(
          new Validation(
            'DocumentReference author object does not contain a reference to the Practitioner who authorized the document',
            Severity.ERROR,
          ),
        )
      }
    })
  }
  if (!documentReference.content) {
    newValidations.push(new Validation('DocumentReference does not contain a content object', Severity.ERROR))
  } else {
    documentReference.content.forEach((content) => {
      if (!content.attachment) {
        newValidations.push(
          new Validation('DocumentReference content object does not contain an attachment object', Severity.ERROR),
        )
        return
      }
      if (!content.attachment.title) {
        newValidations.push(
          new Validation('DocumentReference content attachment object does not contain a title', Severity.ERROR),
        )
      }
      if (!content.attachment.data && !content.attachment.url) {
        newValidations.push(
          new Validation(
            `DocumentReference content attachment object does not contain a "data" or "url" object. DocumentReference must either have a b64-encoded PDF in the data field, or a reference to a Binary on the FHIR-server in the url field, i.e: "Binary/<reference>"`,
            Severity.ERROR,
          ),
        )
      } else if (content.attachment.url) {
        newValidations.push(
          new Validation(
            'DocumentReference content attachment object contains "url" with a reference to a binary file on the FHIR-server - all good"',
            Severity.INFO,
          ),
        )
      }
      if (!content.attachment.contentType && !content.attachment.url) {
        newValidations.push(
          new Validation(
            'DocumentReference content attachment object does not contain the contentType object, should be "application/pdf. This is required when sending b64 encoded files in the "data" object. "',
            Severity.ERROR,
          ),
        )
      } else if (content.attachment.data && content.attachment.contentType === 'application/pdf') {
        newValidations.push(
          new Validation(
            'DocumentReference content attachment object contains "data" with b64 encoded PDF - all good"',
            Severity.INFO,
          ),
        )
      }
      if (!content.attachment.language) {
        newValidations.push(
          new Validation(
            'DocumentReference content attachment object does not contain a language object',
            Severity.ERROR,
          ),
        )
      }
    })
  }

  if (!documentReference.context) {
    newValidations.push(new Validation('DocumentReference does not contain a context object', Severity.ERROR))
  } else if (!documentReference.context.encounter) {
    newValidations.push(
      new Validation('DocumentReference context object does not contain an encounter object', Severity.ERROR),
    )
  }

  return newValidations
}
