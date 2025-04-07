import { useQuery } from '@tanstack/react-query'
import type { DocumentReference } from 'fhir/r4'
import Client from 'fhirclient/lib/Client'

export function useDocumentReferenceQuery(client: Client, docRefId: string | undefined) {
  return useQuery({
    queryKey: ['documentReferenceValidation', docRefId],
    queryFn: async () => {
      if (!docRefId) return

      console.debug('DocumentReference ID:', docRefId)
      const documentReferences = await client.request<DocumentReference>(`DocumentReference/${docRefId}`)

      console.debug('✅ DocumentReference data fetched')
      Object.entries(documentReferences).forEach(([key, value]) => {
        console.debug(`ℹ️ DocumentReference.${key}:`, value)
      })

      return documentReferences
    },
    enabled: !!docRefId,
  })
}
