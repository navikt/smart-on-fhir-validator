import { type Severity, type Validation } from '../../validation/Validation'

import Pill from './Pill'

const severityRank: Record<Severity, number> = {
  ERROR: 3,
  WARNING: 2,
  INFO: 1,
  OK: 0,
}

export interface ValidationTableProps {
  readonly validations: Validation[] | undefined
}

export default function ValidationTable({ validations }: ValidationTableProps) {
  if (!validations) return

  const sortedValidations = [...validations].sort((a, b) => severityRank[b.severity] - severityRank[a.severity])

  return (
    <div>
      {validations.length > 0 ? (
        <table className="text-left w-full border-collapse table-auto">
          <thead className="uppercase bg-neutral-600 text-white">
            <tr className="border-2 border-white rounded">
              <th className="px-6 py-2 w-36 border-r-2 border-white">Severity</th>
              <th className="px-6 py-2">Validation results</th>
            </tr>
          </thead>
          <tbody>
            {sortedValidations.map((validation, index) => (
              <tr key={index} className="border-2 border-white even:bg-gray-100 odd:bg-gray-300 h-full align-top">
                <td className="px-6 py-2 w-36 border-r-2 border-white align-middle">
                  <div className="flex items-center justify-center h-full">
                    <Pill severity={validation.severity} />
                  </div>
                </td>
                <td className="px-6 py-3 flex items-center justify-start h-full">{validation.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <table className="text-left w-full border-collapse table-auto">
            <thead className="uppercase bg-neutral-600 text-white">
              <tr className="border-2 border-white rounded">
                <th className="px-6 py-2 w-36 border-r-2 border-white">Severity</th>
                <th className="px-6 py-2">Validation results</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-2 border-white even:bg-gray-100 odd:bg-gray-300 h-full align-top">
                <td className="px-6 py-2 w-36 border-r-2 border-white align-middle">
                  <div className="flex items-center justify-center h-full">
                    <Pill severity="OK" />
                  </div>
                </td>
                <td className="px-6 py-3 flex items-center justify-start h-full">✅ No issues to report</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
