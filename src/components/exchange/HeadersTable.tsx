import type { ReactElement } from 'react'

export function HeadersTable({ headers }: { headers: Record<string, string> }): ReactElement | null {
    const entries = Object.entries(headers)
    if (entries.length === 0) return null

    return (
        <table className="text-13 w-full border-collapse">
            <caption className="sr-only">HTTP headers</caption>
            <thead>
                <tr className="border-ax-border-neutral-subtle border-b text-left">
                    <th scope="col" className="text-ax-text-neutral-subtle py-1 pr-3 font-medium">
                        Header
                    </th>
                    <th scope="col" className="text-ax-text-neutral-subtle py-1 font-medium">
                        Value
                    </th>
                </tr>
            </thead>
            <tbody>
                {entries.map(([name, value]) => (
                    <tr key={name} className="border-ax-border-neutral-subtleA border-b align-top">
                        <th scope="row" className="font-mono py-1 pr-3 font-normal whitespace-nowrap">
                            {name}
                        </th>
                        <td className="font-mono py-1 break-all">{value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}
