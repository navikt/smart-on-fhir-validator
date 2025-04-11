import { Suspense, lazy } from 'react'

import type { JsonHighlighterProps } from './JsonHighlighter'

const JsonHiglighter = lazy(() => import('./JsonHighlighter'))

export function LazyJsonHighlighter(props: JsonHighlighterProps) {
  return (
    <Suspense fallback={<div>Loading code highlighter...</div>}>
      <JsonHiglighter {...props} />
    </Suspense>
  )
}
