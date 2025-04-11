import React, { type ReactElement } from 'react'

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import prism from 'react-syntax-highlighter/dist/esm/styles/prism/prism'

SyntaxHighlighter.registerLanguage('json', json)

export type JsonHighlighterProps = {
  readonly children: string
}

function JsonHighlighter({ children }: JsonHighlighterProps): ReactElement {
  return (
    <SyntaxHighlighter language="json" style={prism}>
      {children}
    </SyntaxHighlighter>
  )
}

export default JsonHighlighter
