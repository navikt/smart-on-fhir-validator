import { type PropsWithChildren } from 'react'

type Props = {
  title: string
  index: string
  description?: string
  refs?: {
    fhir?: string
    hl7?: string
    nav?: string
  }
}

const ValidationSection = ({ title, index, description, refs, children }: PropsWithChildren<Props>) => {
  return (
    <div className="my-3">
      <h3 className="ml-4 mb-2 font-bold">
        {index}. {title}
      </h3>
      {description && <p className="ml-4 text-sm -mt-2 mb-2 italic">{description}</p>}
      {(refs?.fhir || refs?.nav || refs?.hl7) && (
        <div className="ml-4 -mt-6 text-xs align-middle inline-flex gap-3">
          {refs.fhir && (
            <a href={`${refs.fhir}`} target="_blank" rel="noreferrer" className="text-blue-900 inline-block">
              🔥&#xFE0E; FHIR docs
            </a>
          )}
          {refs.hl7 && (
            <a href={`${refs.hl7}`} target="_blank" rel="noreferrer" className="text-blue-900 inline-block">
              ❤&#xFE0E; HL7 docs
            </a>
          )}
          {refs.nav && (
            <a href={`${refs.nav}`} target="_blank" rel="noreferrer" className="text-blue-900 inline-block">
              🧾&#xFE0E; Nav docs
            </a>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

export default ValidationSection
