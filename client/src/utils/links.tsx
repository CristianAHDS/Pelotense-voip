import React from 'react'

export function renderTextWithLinks(text: string) {
  const urlRegex = /(https?:\/\/[^\s<]+)/g
  const parts = text.split(urlRegex)
  const matches = text.match(urlRegex) ?? []
  let matchIdx = 0
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const url = matches[matchIdx++]
      return <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="chat-link">{url}</a>
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}
