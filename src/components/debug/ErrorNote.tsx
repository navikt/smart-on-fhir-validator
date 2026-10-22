import type { ReactElement } from 'react'

export function ErrorNote({ title, detail }: { title: string; detail: string }): ReactElement {
    return (
        <div
            role="alert"
            className="text-16 rounded border border-l-8 border-ax-border-danger bg-ax-bg-danger-soft px-4 py-3 text-ax-text-danger"
        >
            <p className="font-bold">{title}</p>
            <p className="mt-1 max-w-[70ch] break-words">{detail}</p>
        </div>
    )
}
