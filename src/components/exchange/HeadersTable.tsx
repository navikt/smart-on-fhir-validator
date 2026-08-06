import type { ReactElement } from 'react'

export function HeadersTable({ headers }: { headers: Record<string, string> }): ReactElement | null {
    const entries = Object.entries(headers)
    if (entries.length === 0) return null

    return (
        <table className="w-full border-collapse text-xs">
            <caption className="sr-only">HTTP headers</caption>
            <thead>
                <tr className="border-b border-neutral-300 text-left">
                    <th scope="col" className="py-1 pr-3 font-medium text-neutral-600">
                        Header
                    </th>
                    <th scope="col" className="py-1 font-medium text-neutral-600">
                        Value
                    </th>
                </tr>
            </thead>
            <tbody>
                {entries.map(([name, value]) => (
                    <tr key={name} className="border-b border-neutral-100 align-top">
                        <th scope="row" className="py-1 pr-3 font-mono font-normal whitespace-nowrap">
                            {name}
                        </th>
                        <td className="py-1 font-mono break-all">{value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
