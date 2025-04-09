import React, { type ReactElement } from 'react'

type Props = {
  href: string
  emoji: 'hl7' | 'fhir' | 'nav'
  text: string
}

function RefLink({ href, emoji, text }: Props): ReactElement {
  return (
    <a href={`${href}`} target="_blank" rel="noreferrer" className="text-blue-900 inline-block hover:underline">
      {getEmoji(emoji)}&#xFE0E; {text}
    </a>
  )
}

function getEmoji(emoji: Props['emoji']) {
  switch (emoji) {
    case 'hl7':
      return '❤'
    case 'fhir':
      return '🔥'
    case 'nav':
      return '🧾'
  }
}

export default RefLink
