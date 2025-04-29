import { useQuery } from '@tanstack/react-query'
import { oauth2 as SMART } from 'fhirclient'

export function useSmart() {
  const {
    data: client,
    error,
    isLoading,
    failureCount,
  } = useQuery({
    queryKey: ['smartClient'],
    queryFn: () => {
      return SMART.ready()
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
