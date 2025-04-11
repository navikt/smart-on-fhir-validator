import type { ReactElement } from 'react'

import { type Severity, type Validation } from '../../validation/validation'
import RefLink from '../ref-link/RefLink'

import Pill from './Pill'

const severityRank: Record<Severity, number> = {
  ERROR: 3,
  WARNING: 2,
  INFO: 1,
  OK: 0,
}

export interface ValidationTableProps {
  readonly validations: Validation[]
  readonly source: unknown | undefined
}

export default function Validations({ validations, source }: ValidationTableProps) {
  return (
    <div>
      {validations.length > 0 ? <ValidationsTable validations={validations} /> : <ValidationsOK />}
      {source != null && (
        <details className="border border-neutral-400 rounded text-neutral-700 mt-2">
          <summary className="p-2 pl-4">See source of validated data</summary>
          <div className="p-4">
            <pre className="p-1">{JSON.stringify(source, null, 2)}</pre>
          </div>
        </details>
      )}
    </div>
  )
}

function ValidationsOK(): ReactElement {
  return (
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
  )
}

function ValidationsTable({ validations }: { validations: Validation[] }): ReactElement {
  const sortedValidations = [...validations].sort((a, b) => severityRank[b.severity] - severityRank[a.severity])

  return (
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
            <td className="px-6 py-3 flex flex-col justify-start h-full">
              <div>{validation.message}</div>
              {validation.refs && (
                <div className="text-xs align-middle inline-flex gap-3">
                  {validation.refs?.hl7 && <RefLink href={validation.refs?.hl7} type="hl7" />}
                  {validation.refs?.simplifier && <RefLink href={validation.refs?.simplifier} type="simplifier" />}
                  {validation.refs?.nav && <RefLink href={validation.refs?.nav} type="nav" />}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
