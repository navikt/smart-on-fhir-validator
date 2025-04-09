import { type PropsWithChildren } from 'react'

import type { RefTypes } from '../../validation/common-refs'
import RefLink from '../ref-link/RefLink'

type Props = {
  title: string
  index: string
  description?: string
  refs?: RefTypes
}

const ValidationSection = ({ title, index, description, refs, children }: PropsWithChildren<Props>) => {
  return (
    <div className="my-3">
      <h3 className="ml-4 mb-2 font-bold">
        {index}. {title}
      </h3>
      {description && <p className="ml-4 text-sm -mt-2 mb-2 italic">{description}</p>}
      {(refs?.simplifier || refs?.nav || refs?.simplifier) && (
        <div className="ml-4 -mt-6 text-xs align-middle inline-flex gap-3">
          {refs.hl7 && <RefLink href={refs.hl7} type="hl7" />}
          {refs.simplifier && <RefLink href={refs.simplifier} type="simplifier" />}
          {refs.nav && <RefLink href={refs.nav} type="nav" />}
        </div>
      )}
      {children}
    </div>
  )
}

export default ValidationSection
