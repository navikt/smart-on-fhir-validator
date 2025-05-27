import { useState } from 'react'

import { useMutation } from '@tanstack/react-query'
import type { DocumentReference } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { pdf } from '../../../mocks/base64pdf'
import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

import { useDocumentReferenceQuery } from './useDocumentReferenceQuery'
import { validateDocumentReference } from './validateDocRef'

export interface B64WritableDocumentReferenceProps {
  readonly client: Client
}

export default function B64WritableDocumentReference({ client }: B64WritableDocumentReferenceProps) {
  const [docRefId, setDocRefId] = useState<string | undefined>(undefined)

  const {
    mutate: mutateDocumentReference,
    isPending: createdDocumentReferenceIsPending,
    error: createdDocumentReferenceUploadError,
    isSuccess: isSuccessDocRef,
  } = useMutation({
    mutationFn: async (documentReference: DocumentReference) => {
      const response = await client.create({
        ...documentReference,
        meta: { lastUpdated: new Date().toISOString() },
      })

      if (!response.id) {
        throw new Error(`Failed to create DocumentReference: ${response.statusText}`)
      }
      return response
    },
    onSuccess: (response) => {
      console.log('✅ DocumentReference created with ID:', response.id)
      setDocRefId(response.id)
    },
  })

  const { error, data, isLoading } = useDocumentReferenceQuery(client, docRefId)
  const validations: Validation[] = data ? validateDocumentReference(data) : []

  // create document reference if it does not exist
  if (!docRefId) {
    return (
      <div className="flex flex-col">
        {createdDocumentReferenceUploadError && (
          <div className="mb-2">
            <Validations
              validations={[
                validation(
                  handleError(
                    'Error while creating new DocumentReference based on b64 encoded data',
                    createdDocumentReferenceUploadError,
                  ),
                  'ERROR',
                ),
              ]}
              source={data}
            />
          </div>
        )}

        <div className="flex gap-4 mb-5">
          <button
            className="border border-blue-900 rounded-sm bg-blue-300 p-4 py-2 text-gray-900 cursor-pointer"
            onClick={() => {
              const newDocumentReference = getDocRefWithB64Data(client)
              mutateDocumentReference(newDocumentReference)
            }}
            disabled={createdDocumentReferenceIsPending || isSuccessDocRef}
          >
            {createdDocumentReferenceIsPending ? 'Uploading...' : 'Upload DocumentReference (b64)'}
          </button>
        </div>
      </div>
    )
  }

  if (createdDocumentReferenceUploadError) {
    return (
      <div>
        <Validations
          validations={[
            validation(
              handleError('Error while creating new DocumentReference based on b64 encoded data', error),
              'ERROR',
            ),
          ]}
          source={data}
        />
      </div>
    )
  }

  if (isLoading) {
    return <Spinner text="Loading DocumentReference data..." />
  }

  if (error) {
    return (
      <div>
        <Validations
          validations={[validation(handleError('Unable to fetch Writable DocumentReference', error), 'ERROR')]}
          source={data}
        />
      </div>
    )
  } else {
    return (
      <div>
        <div>
          <Validations validations={validations} source={data} />
        </div>
      </div>
    )
  }
}

function getDocRefWithB64Data(client: Client): DocumentReference {
  return {
    resourceType: 'DocumentReference',
    status: 'current',
    type: {
      coding: [
        {
          system: 'urn:oid:2.16.578.1.12.4.1.1.9602',
          code: 'J01-2',
          display: 'Sykmeldinger og trygdesaker',
        },
      ],
    },
    subject: {
      reference: `Patient/${client.patient.id}`,
    },
    author: [
      {
        reference: `Practitioner/${client.user.fhirUser}`,
      },
    ],
    description: 'My cool document description with a b64 data',
    content: [
      {
        attachment: {
          title: 'My cool sykmelding document',
          language: 'NO-nb',
          contentType: 'application/pdf',
          data: pdf,
        },
      },
    ],
    context: {
      encounter: [
        {
          reference: `Encounter/${client.encounter.id}`,
        },
      ],
    },
  }
}
