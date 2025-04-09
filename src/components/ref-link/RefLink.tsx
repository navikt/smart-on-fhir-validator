import React, { type ReactElement } from 'react'

import type { RefTypes } from '../../validation/common-refs'

type Props = {
  href: string
  type: keyof RefTypes
}

function RefLink({ href, type }: Props): ReactElement {
  return (
    <a href={`${href}`} target="_blank" rel="noreferrer" className="text-blue-900 inline-block hover:underline">
      {getEmoji(type)}&#xFE0E; {getText(type)}
    </a>
  )
}

function getEmoji(emoji: Props['type']) {
  switch (emoji) {
    case 'hl7':
      return '🔥'
    case 'simplifier':
      return '❤'
    case 'nav':
      return '🧾'
  }
}

function getText(emoji: Props['type']) {
  switch (emoji) {
    case 'hl7':
      return 'HL7 docs'
    case 'simplifier':
      return 'Simplifier docs'
    case 'nav':
      return 'NAV docs'
  }
}

export default RefLink
