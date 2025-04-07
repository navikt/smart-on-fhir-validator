import clsx from 'clsx'

import type { Severity } from '../../utils/Validation'

type Props = {
  severity: Severity
}

const Pill = ({ severity }: Props) => {
  return (
    <div
      className={clsx(`h-7 w-22 p-1 rounded border flex justify-center items-center`, {
        ' text-green-800 bg-green-200': severity === 'OK',
        'text-blue-800 bg-blue-200': severity === 'INFO',
        'text-red-700 bg-red-200': severity === 'ERROR',
        'text-yellow-700 bg-yellow-200': severity === 'WARNING',
      })}
    >
      {severity}
    </div>
  )
}

export default Pill
