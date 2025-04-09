import { useState } from 'react'

import { useMutation } from '@tanstack/react-query'
import type { DocumentReference } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

import { pdf } from '../../../mocks/base64pdf'
import { handleError } from '../../../utils/ErrorHandler'
import { type Validation, validation } from '../../../validation/validation'
import Spinner from '../../spinner/Spinner'
import ValidationTable from '../../validation-table/ValidationTable'

import { useDocumentReferenceQuery } from './useDocumentReferenceQuery'
import { validateDocumentReference } from './validateDocRef'

export interface BinaryUploadWritableDocumentReferenceProps {
  readonly client: Client
}

export default function BinaryUploadWritableDocumentReference({ client }: BinaryUploadWritableDocumentReferenceProps) {
  const [docRefId, setDocRefId] = useState<string | undefined>(undefined)
  const { mutate, isPending, error, data, isSuccess } = useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const binaryCreationResponse = await client.create({
        resourceType: 'Binary',
        contentType: file.type,
        data: file,
      })
      if (!binaryCreationResponse.id) {
        console.log('Failed to create Binary, ', binaryCreationResponse)
        throw new Error(`Failed to create Binary: ${binaryCreationResponse.statusText}`)
      }

      const docRefCreationResponse = await client.create({
        resourceType: 'DocumentReference',
        body: JSON.stringify(getDocRefWithBinary(client, binaryCreationResponse.id)),
        headers: {
          'Content-Type': 'application/fhir+json',
        },
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
      <ValidationTable
        validations={[
          validation(
            handleError('Error while creating new DocumentReference with a binary file reference', error),
            'ERROR',
          ),
        ]}
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
                mutate({ file: base64ToFile(pdf, 'sykmelding.pdf') })
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
      <ValidationTable
        validations={[
          validation(
            handleError(
              'Error while creating new DocumentReference with a binary file reference, the binary id appears to be missing',
              error,
            ),
            'ERROR',
          ),
        ]}
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
        <ValidationTable
          validations={[validation(handleError('Unable to fetch Writable DocumentReference', error), 'ERROR')]}
        />
      </div>
    )
  } else {
    const validations: Validation[] = data ? validateDocumentReference(fetchedDocRefData) : []
    return (
      <div>
        <div>
          <ValidationTable validations={validations} />
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

function base64ToFile(base64String: string, fileName: string): File {
  // Remove the Base64 metadata (if present)
  const base64WithoutPrefix = base64String.split(',').pop() || ''

  const byteCharacters = atob(base64WithoutPrefix)
  const byteNumbers = new Array(byteCharacters.length)

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }

  const byteArray = new Uint8Array(byteNumbers)

  const blob = new Blob([byteArray], { type: 'application/pdf' })
  return new File([blob], fileName, { type: 'application/pdf' })
}
