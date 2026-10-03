import React from 'react'
import { Bird, Globe, HardDrive, Puzzle, Youtube } from 'lucide-react'
import { downloadSourceLabel, streamRef } from '../onlineTracks'

// Quiet, single-colour marks at list sizes. Soulseek uses its bird motif;
// addons share a puzzle piece rather than many competing full-colour logos.
export default function SourceIcon({ source, size = 14, className = '' }) {
  const props = { width: size, height: size, className: `shrink-0 ${className}`, 'aria-hidden': true }
  if (source === 'sc') return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12v4m3-6v8m3-9v9m3-12v12h7a4 4 0 1 0-.5-8A6 6 0 0 0 11 6Z" />
    </svg>
  )
  const Icon = source === 'yt' ? Youtube
    : source === 'soulseek' || source === 'slsk' ? Bird
      : source === 'local' ? HardDrive
        : source?.startsWith('a-') ? Puzzle : Globe
  return <Icon {...props} />
}

export function TrackSourceIcon({ track, addonNames, className = '' }) {
  const stream = streamRef(track)
  const source = stream?.provider || track.download_source
  const label = downloadSourceLabel(source, addonNames)
  const local = !source && !String(track.file_path || '').startsWith('ghost://')
  const description = label ? `${stream ? 'Streamed' : 'Downloaded'} from ${label}${stream ? ' · not in your library yet' : ''}` : local ? 'Local file' : 'Source unknown'
  return (
    <span role="img" aria-label={description} title={description} className={`inline-flex shrink-0 items-center justify-center text-muted ${className}`}>
      <SourceIcon source={local ? 'local' : source} />
    </span>
  )
}
