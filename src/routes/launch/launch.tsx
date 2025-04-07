import { useQuery } from '@tanstack/react-query'
import { oauth2 as SMART } from 'fhirclient'

import ErrorPage from '../../components/layout/ErrorPage'
import Header from '../../components/layout/Header'
import Page from '../../components/layout/Page'
import Spinner from '../../components/spinner/Spinner'
import { authOptions } from '../../fhir/FhirAuth'

export default function Launch() {
  /**
   * STEP 1 - FHIR authorization
   *
   * This step takes the client configuration via authOptions and requests permission to launch
   * the SMART on FHIR framework for the given provider.
   *
   * When launch is called from within the EHR, the `iss` option **MUST NOT** be passed as it
   * is provided by the EHR. The `iss` will then be equal to the FHIR server resource used
   * for fetching data from the FHIR API.
   */
  const { error, isLoading } = useQuery({
    queryKey: ['smartAuth'],
    queryFn: async () => {
      // Ikke gjør noe med promise callback, denne siden skal bare omdirigere.
      await SMART.authorize(authOptions)

      // React Query blir sur om man ikke returnerer noe fra en query-fn
      return null
    },
  })

  return (
    <Page sidebar={null}>
      <Header />
      <div className="my-3">
        <h2 className="ml-8 font-bold text-2xl">Smart on FHIR Launch!</h2>
        {isLoading ? (
          <Spinner text="Launching SMART application..." />
        ) : !error ? (
          <Spinner text="Launch complete! Redirecting..." />
        ) : (
          <ErrorPage error={error.message} />
        )}
      </div>
    </Page>
  )
}
