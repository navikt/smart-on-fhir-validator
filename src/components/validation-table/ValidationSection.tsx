import { type PropsWithChildren } from 'react'

import RefLink from '../ref-link/RefLink'

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
          {refs.fhir && <RefLink href={refs.fhir} emoji="fhir" text="FHIR docs" />}
          {refs.hl7 && <RefLink href={refs.hl7} emoji="hl7" text="HL7 docs" />}
          {refs.nav && <RefLink href={refs.nav} emoji="nav" text="Nav docs" />}
        </div>
      )}
      {children}
    </div>
  )
}

export default ValidationSection
