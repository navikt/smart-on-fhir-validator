import type { ReactElement } from 'react'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import prism from 'react-syntax-highlighter/dist/esm/styles/prism/prism'

SyntaxHighlighter.registerLanguage('json', json)

/**
 * Pretty-prints a JSON-serialisable value with syntax highlighting. `react-syntax-highlighter`
 * touches no browser-only API, so this renders entirely on the server — no client JS is shipped
 * just to colour a request or response body.
 */
export function JsonBlock({ value }: { value: unknown }): ReactElement {
    const text = JSON.stringify(value, null, 2) ?? 'null'

    return (
        <SyntaxHighlighter
            language="json"
            style={prism}
            customStyle={{ margin: 0, fontSize: '0.8rem' }}
            role="code"
        >
            {text}
        </SyntaxHighlighter>
    )
}
