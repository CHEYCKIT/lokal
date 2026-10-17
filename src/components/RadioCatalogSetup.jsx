// Online radio: the link to the station catalogue (a JSON file), on the
// Online Radio page until there is one, and in Settings > Online Radio. The
// file is downloaded and parsed in the main process; only its data is kept.
// A file that doesn't parse opens a window saying exactly what's wrong.

import React, { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import Modal from './Modal'
import { useRadioStore } from '../store/radio'
import { useTranslation } from '../i18n'

export const CATALOG_EXAMPLE = `{
  "version": 1,
  "title": "My stations",
  "stations": [
    {
      "title": "LoFi Radio",
      "url": "https://live.lofiradio.ru/lofi_mp3_128",
      "genre": "LoFi",
      "description": "LoFi Girl",
      "history": "https://example.com/lofi/history",
      "icon": "https://example.com/icons/lofi.jpg"
    },
    {
      "title": "Radio Rivendell",
      "url": "https://play.radiorivendell.com/radio/8000/radio.mp3",
      "api": { "type": "azuracast", "url": "https://play.radiorivendell.com/api/nowplaying/radio_rivendell" }
    },
    {
      "title": "Record Rap Hits",
      "url": "https://radiorecord.hostingradio.ru/rap96.aacp",
      "api": { "type": "radiorecord", "station": "rap" }
    },
    {
      "title": "laut.fm EDM",
      "url": "https://edm.stream.laut.fm/edm",
      "api": { "type": "lautfm", "station": "edm" }
    },
    {
      "title": "Another station",
      "url": "https://example.com/stream",
      "api": { "type": "json", "url": "https://example.com/now.json",
               "artist": "now.artist", "title": "now.title", "cover": "now.art" }
    }
  ]
}`

const FIELD_NOTES = [
  ['title', 'required: the station\'s name'],
  ['url', 'required: the stream\'s address (http or https)'],
  ['genre', 'optional: shown in the Genre column'],
  ['description', 'optional: shown in the Comment column (a link opens in the browser)'],
  ['history', 'optional: a link to the station\'s played-songs history, shown in the History column and in the station\'s menu'],
  ['icon', 'optional: a picture, shown in the list and as the cover until a song\'s own is found'],
  ['api', 'optional: the station\'s own "now playing" service, for covers, album and lyrics: azuracast (url), radiorecord (station), lautfm (station), or json (url and where each field is: artist, title or text, cover, album, lyrics, duration)'],
]

/** One problem in the catalogue, as a sentence. */
export function catalogErrorText(error, t) {
  const at = error.path ? `${error.path}: ` : ''
  switch (error.code) {
    case 'json-syntax': return error.line
      ? t('The file isn\'t valid JSON (line {line}, column {column}): {detail}', { line: error.line, column: error.column, detail: error.detail })
      : t('The file isn\'t valid JSON: {detail}', { detail: error.detail })
    case 'empty': return t('The file is empty.')
    case 'root-not-object': return t('The file must be a JSON object with a "stations" list.')
    case 'required-missing': return at + t('the required field "{field}" wasn\'t found.', { field: error.field })
    case 'not-array': return at + t('must be a list ([...]).')
    case 'not-string': return at + t('must be text.')
    case 'bad-url': return at + t('must be an http:// or https:// link.')
    case 'station-not-object': return at + t('must be an object ({...}) with "title" and "url".')
    case 'api-not-object': return at + t('must be an object ({...}) with a "type".')
    case 'api-type-unknown': return at + t('unknown type "{type}" (known: {types}).', { type: error.detail, types: (error.allowed || []).join(', ') })
    case 'api-json-fields': return at + t('a "json" API needs "text", or "artist" and "title": where those are in its answer.')
    case 'bad-catalog-url': return t('The catalogue link must start with http:// or https://.')
    case 'http': return t('The server answered {status}.', { status: error.detail })
    case 'too-large': return t('The file is larger than 2 MB.')
    case 'timeout': return t('The server didn\'t answer in time.')
    case 'network': return t('Couldn\'t download the file: {detail}', { detail: error.detail || '' })
    default: return at + (error.detail || error.code || '')
  }
}

/** The window listing why a catalogue couldn't be used. */
export function CatalogErrorModal({ errors, onClose }) {
  const { t } = useTranslation()
  const syntax = errors?.find(error => error.excerpt)
  return (
    <Modal open={!!errors?.length} onClose={onClose} title={t('The station catalogue couldn\'t be loaded')} width="max-w-2xl">
      <div className="space-y-3 text-sm">
        <p className="text-muted">{t('Nothing was changed: the stations already loaded stay as they were. Fix the file and try again.')}</p>
        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-3 font-mono text-xs text-red-200">
          {(errors || []).map((error, index) => <li key={index} className="break-words">{catalogErrorText(error, t)}</li>)}
        </ul>
        {syntax && <pre className="overflow-x-auto rounded-lg border border-border bg-card p-3 text-[11px] leading-relaxed text-muted">{syntax.excerpt}</pre>}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-base hover:opacity-90">{t('Close')}</button>
        </div>
      </div>
    </Modal>
  )
}

export default function RadioCatalogSetup({ onLoaded, showExample = true }) {
  const { t } = useTranslation()
  const { url: savedUrl, catalog, updatedAt, loading, loadCatalog, init } = useRadioStore()
  const [draft, setDraft] = useState(savedUrl)
  const [errors, setErrors] = useState(null)
  useEffect(() => { init() }, [init])
  useEffect(() => { setDraft(savedUrl) }, [savedUrl])

  const trimmed = draft.trim()
  const changed = trimmed && trimmed !== savedUrl
  const load = async (url) => {
    const result = await loadCatalog(url)
    if (result?.ok) onLoaded?.(result)
    else setErrors(result?.errors?.length ? result.errors : [{ path: '', code: 'network' }])
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="url" value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false}
          onKeyDown={e => { if (e.key === 'Enter' && changed && !loading) load(trimmed) }}
          placeholder="https://example.com/radio.json" aria-label={t('Station catalogue link')}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:border-accent focus:outline-none" />
        {changed && (
          <button type="button" disabled={loading} onClick={() => load(trimmed)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-base hover:opacity-90 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {t('Load')}
          </button>
        )}
        {!changed && savedUrl && (
          <button type="button" disabled={loading} onClick={() => load(savedUrl)} title={t('Download the catalogue again')}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-elevated disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {t('Update')}
          </button>
        )}
      </div>
      {catalog && (
        <p className="text-xs text-muted">
          {t('Loaded: {n} station|Loaded: {n} stations', { n: catalog.stations.length })}
          {catalog.title ? ` · ${catalog.title}` : ''}
          {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}
        </p>
      )}
      {showExample && (
        <details className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted">
          <summary className="cursor-pointer select-none text-text">{t('What the catalogue file looks like')}</summary>
          <ul className="mt-2 space-y-1">
            {FIELD_NOTES.map(([field, note]) => <li key={field}><code className="text-accent">{field}</code> — {t(note)}</li>)}
          </ul>
          <pre className="mt-2 overflow-x-auto rounded-md bg-surface p-3 text-[11px] leading-relaxed">{CATALOG_EXAMPLE}</pre>
          <p className="mt-2">{t('The stations are listed in the order of the file. Only the data is kept, not the file: "Update" downloads it again.')}</p>
        </details>
      )}
      <CatalogErrorModal errors={errors} onClose={() => setErrors(null)} />
    </div>
  )
}
