import { useEffect } from 'react'

interface ErrorPageProps {
  error: string
}

export default function ErrorPage({ error }: ErrorPageProps) {
  useEffect(() => {
    console.error(error)
  }, [])

  return (
    <div id="error-page" className="border p-4 max-w-prose rounded bg-red-200 ml-8">
      <h2 className="font-bold text-2xl mb-2">An unrecoverable error has occurred</h2>
      <p>
        <b>Please ensure you comply with these requirements:</b>
      </p>
      <ul>
        <li>
          The app has been launched from the <b>/launch</b> URL
        </li>
        <li>You are allowed to request the scopes defined</li>
        <li>The .well-known/smart-configuration endpoint is available</li>
        <li>The client_id is registered with the EHR</li>
        <li>The FHIR server supports FHIR version R4</li>
      </ul>
      <br />
      <h3 className="font-bold">Techincal Error:</h3>
      <pre className="whitespace-pre-wrap break-words border border-red-900 p-1">{error}</pre>
    </div>
  )
}
