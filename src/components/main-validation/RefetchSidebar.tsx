import { Link } from 'react-router'

import { useSmart } from '../../smart/use-smart'

const RefetchSidebar = () => {
  const { client, isLoading } = useSmart()

  if (isLoading) return null

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-bold">Manual FHIR Resource Actions</h2>
        <div className="flex flex-col gap-4 justify-center">
          <p className="text-sm">Output of refetched actions can be found in your browser console.</p>
          <button
            className="border border-blue-900 rounded-sm bg-blue-300 p-4 py-2 text-gray-900 cursor-pointer"
            onClick={async () => {
              const webMedPractitionerId = client?.getState('tokenResponse.practitioner')
              const practitioner = await client?.request(`Practitioner/${webMedPractitionerId}`)
              Object.entries(practitioner).forEach(([key, value]) => {
                console.debug(`ℹ️ (manual) Practitioner.${key}:`, JSON.stringify(value))
              })
            }}
          >
            Fetch WebMed Practitioner
          </button>
          <button
            className="border border-blue-900 rounded-sm bg-blue-300 p-4 py-2 text-gray-900 cursor-pointer"
            onClick={async () => {
              const practitioner = await client?.request(`Patient/${client.patient.id}`)
              Object.entries(practitioner).forEach(([key, value]) => {
                console.debug(`ℹ️ (manual) Practitioner.${key}:`, JSON.stringify(value))
              })
            }}
          >
            Fetch Patient
          </button>
          <button
            className="border border-blue-900 rounded-sm bg-blue-300 p-4 py-2 text-gray-900 cursor-pointer"
            onClick={async () => {
              const encounter = await client?.request(`Encounter/${client.encounter.id}`)
              Object.entries(encounter).forEach(([key, value]) => {
                console.debug(`ℹ️ (manual) Encounter.${key}:`, JSON.stringify(value))
              })
            }}
          >
            Fetch Encounter
          </button>
        </div>
      </div>
      <div>
        <h2 className="font-bold mt-8 mb-0 p-0">Other utilities</h2>
        <div className="flex flex-col gap-3">
          <p className="text-sm">Manual utilities for poking around in the FHIR servers APIs</p>
          <Link className="underline" to="/fhir-tester">
            FHIR Resource Tester
          </Link>
          <Link className="underline" to="/fhir-creator">
            FHIR Mutation Tester
          </Link>
        </div>
      </div>
    </div>
  )
}

export default RefetchSidebar
