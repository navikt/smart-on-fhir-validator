import type { PropsWithChildren, ReactNode } from 'react'

type Props = {
  sidebar: ReactNode | null
}

const Page = ({ children, sidebar }: PropsWithChildren<Props>) => {
  return (
    <div className="flex flex-row">
      <div className="grow m-4 mt-4">{children}</div>
      {sidebar != null && (
        <div className="max-w-64 m-4 mt-0 pt-10 border-l border-l-gray-300 pl-4 relative">
          <div className="absolute top-10 sticky">{sidebar}</div>
        </div>
      )}
    </div>
  )
}

export default Page
