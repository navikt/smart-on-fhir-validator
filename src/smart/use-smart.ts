/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from '@tanstack/react-query'

import type { Client } from '../fhir/FakeClient'

function yeetFetchFhir(path: `/${string}`): Promise<any> {
  return fetch(`/fhir${path}`, {}).then((it) => it.json())
}

export function useSmart() {
  const {
    data: client,
    error,
    isLoading,
    failureCount,
  } = useQuery<Client>({
    queryKey: ['smartClient'],
    queryFn: async (): Promise<Client> => {
      const meta = await yeetFetchFhir('/hack-meta')

      return {
        patient: { id: meta.patientId },
        encounter: { id: meta.encounterId },
        fhirUser: meta.fhirUser,
        fhirUserType: meta.fhirUserType,
        request: (path) => yeetFetchFhir(`/${path}` as `/${string}`),
      } satisfies Client
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnMount: false,
  })

  return {
    client,
    error,
    isLoading,
    failureCount,
  }
}
