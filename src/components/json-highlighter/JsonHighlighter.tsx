import React, { type ReactElement } from 'react'

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import prism from 'react-syntax-highlighter/dist/esm/styles/prism/prism'

SyntaxHighlighter.registerLanguage('json', json)

export type JsonHighlighterProps = {
  id?: string
  children: string
}

function JsonHighlighter({ id, children }: JsonHighlighterProps): ReactElement {
  return (
    <SyntaxHighlighter id={id} language="json" style={prism}>
      {children}
    </SyntaxHighlighter>
  )
}

export default JsonHighlighter
