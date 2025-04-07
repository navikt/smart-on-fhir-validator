import { type PropsWithChildren } from 'react'

type Props = {
  title: string
  index: string
  description?: string
}

const ValidationSection = ({ title, index, description, children }: PropsWithChildren<Props>) => {
  return (
    <div className="my-3">
      <h3 className="ml-4 mb-2 font-bold">
        {index}. {title}
      </h3>
      {description && <p className="ml-4 text-sm -mt-2 mb-2 italic">{description}</p>}
      {children}
    </div>
  )
}

export default ValidationSection
