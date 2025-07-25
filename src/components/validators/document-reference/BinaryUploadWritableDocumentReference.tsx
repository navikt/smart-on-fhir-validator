import { useState } from 'react'

import { useMutation } from '@tanstack/react-query'
import type { Binary, DocumentReference } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { pdf } from '../../../mocks/base64pdf'
import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import Validations from '../../validation-table/Validations'

import { useDocumentReferenceQuery } from './useDocumentReferenceQuery'
import { validateDocumentReference } from './validateDocRef'

export interface BinaryUploadWritableDocumentReferenceProps {
  readonly client: Client
}

export default function BinaryUploadWritableDocumentReference({ client }: BinaryUploadWritableDocumentReferenceProps) {
  const [expectedDocRefId] = useState<string>(crypto.randomUUID())
  const [docRefId, setDocRefId] = useState<string | undefined>(undefined)
  const { mutate, isPending, error, data, isSuccess } = useMutation({
    mutationFn: async ({ base64Data }: { base64Data: string }) => {
      const binaryCreationResponse = await client.create({
        resourceType: 'Binary',
        contentType: 'application/pdf',
        data: base64Data,
      } satisfies Binary)
      if (!binaryCreationResponse.id) {
        console.log('Failed to create Binary, ', binaryCreationResponse)
        throw new Error(`Failed to create Binary: ${binaryCreationResponse.statusText}`)
      }

      const docRefCreationResponse = await client.request({
        url: `DocumentReference/${expectedDocRefId}`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: expectedDocRefId,
          ...getDocRefWithBinary(client, binaryCreationResponse.id),
          meta: { lastUpdated: new Date().toISOString() },
        }),
      })

      if (!docRefCreationResponse.id) {
        console.log('Failed to create DocumentReference:', docRefCreationResponse)
        throw new Error(`Failed to create DocumentReference: ${docRefCreationResponse.statusText}`)
      }

      return docRefCreationResponse
    },
    onSuccess(response) {
      console.log('✅ Binary uploaded and documentReference created with ID:', response.id)
      setDocRefId(response.id)
    },
  })

  const {
    error: fetchedDocRefError,
    data: fetchedDocRefData,
    isLoading: fetchedDocRefIsLoading,
  } = useDocumentReferenceQuery(client, docRefId)

  if (isPending) {
    return <Spinner text="Uploading binary file and creating DocumentReference..." />
  }

  if (error) {
    return (
      <Validations
        validations={[
          validation(
            handleError('Error while creating new DocumentReference with a binary file reference', error),
            'ERROR',
          ),
        ]}
        source={data}
      />
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col">
        <div className="flex gap-4 mb-5">
          <div>
            <button
              className="border border-blue-900 rounded-sm bg-blue-300 p-4 py-2 text-gray-900 cursor-pointer"
              onClick={() => {
                mutate({ base64Data: pdf })
              }}
              disabled={isPending || isSuccess}
            >
              {isPending ? 'Uploading...' : 'Upload DocumentReference with a binary file reference'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!data.id) {
    return (
      <Validations
        validations={[
          validation(
            handleError(
              'Error while creating new DocumentReference with a binary file reference, the binary id appears to be missing',
              error,
            ),
            'ERROR',
          ),
        ]}
        source={data}
      />
    )
  }

  if (!fetchedDocRefData) {
    return (
      <div>
        <p>Loading DocumentReference data...</p>
      </div>
    )
  }
  if (fetchedDocRefIsLoading) {
    return (
      <div>
        <p>Loading DocumentReference data...</p>
      </div>
    )
  } else if (fetchedDocRefError) {
    return (
      <div>
        <Validations
          validations={[validation(handleError('Unable to fetch Writable DocumentReference', error), 'ERROR')]}
          source={data}
        />
      </div>
    )
  } else {
    const validations: Validation[] = data ? validateDocumentReference(fetchedDocRefData, expectedDocRefId) : []
    return (
      <div>
        <div>
          <Validations validations={validations} source={data} />
        </div>
      </div>
    )
  }
}

function getDocRefWithBinary(client: Client, id: string): DocumentReference {
  return {
    resourceType: 'DocumentReference',
    status: 'current',
    id: 'aa66036d-b63c-4c5a-b3d5-b1d1f871337c',
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
    description: 'My cool document description with a binary reference',
    content: [
      {
        attachment: {
          title: 'My cool sykmelding document',
          language: 'NO-nb',
          url: `Binary/${id}`, // Using a binary reference to a file. Prereq is that the binary resource is created already.
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
