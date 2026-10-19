// The line under each lyric line: a translation or a romanization (the
// pronunciation in Latin letters), for the lyrics panel and for subtitles
// over a music video. One choice for both ('lokal-lyrics-subline'), changed
// from either: the other follows at once.
//
// A source's own translation or romanization is used when it ships one
// (Apple Music does for many songs); otherwise it's asked for on demand
// (api.translateLyrics / api.romanizeLyrics). Settings → Lyrics → Auto-Translate
// shows the translation under lyrics in another language without asking.

import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { hasNonLatin } from './timing'

const SUBLINE_KEY = 'lokal-lyrics-subline' // 'original' | 'translation' | 'romanization'

function readSubline() {
  try { return localStorage.getItem(SUBLINE_KEY) || 'original' } catch { return 'original' }
}

function writeSubline(value) {
  try { localStorage.setItem(SUBLINE_KEY, value) } catch {}
  window.dispatchEvent(new CustomEvent('lokal:lyrics-subline', { detail: value }))
}

/**
 * @param trackId the song's id; `result` its lyrics (api.getLyrics), `lines`
 *   the lines shown (subLines lines up with them, index for index).
 * @returns { subline, toggle(mode), subLines, wantTranslation, translationBusy,
 *   romanizationBusy, canRomanize, translateTarget }
 */
// Lyrics already in the language translated to: the same base language, and
// for Chinese the same script (zh-TW lyrics still go to a zh-CN target).
const chineseScript = tag => (/^zh[-_](hant|tw|hk|mo)\b/i.test(tag) ? 'hant' : /^zh[-_](hans|cn|sg)\b/i.test(tag) ? 'hans' : '')
export function sameLanguage(language, target) {
  const base = tag => String(tag || '').split(/[-_]/)[0].toLowerCase()
  if (base(language) !== base(target)) return false
  if (base(target) !== 'zh') return true
  const [mine, theirs] = [chineseScript(language), chineseScript(target)]
  return !mine || !theirs || mine === theirs
}

export function useLyricSubline({ trackId, result, lines }) {
  const [subline, setSubline] = useState(readSubline)
  const [translateTarget, setTranslateTarget] = useState('en')
  const [autoTranslate, setAutoTranslate] = useState(false)
  const [translation, setTranslation] = useState({ state: 'idle', lines: null })
  const [romanization, setRomanization] = useState({ state: 'idle', lines: null })
  // Async answers are only applied if they're still for the lyrics on screen
  // (their lines: a result only noting another source's attempt is the same lyrics).
  const sourceLines = result?.lines || null
  const resultRef = useRef(sourceLines)
  resultRef.current = sourceLines
  const trackRef = useRef(trackId)
  trackRef.current = trackId

  // Different lyrics (another song, another source): what was translated is theirs no more.
  useEffect(() => {
    setTranslation({ state: 'idle', lines: null })
    setRomanization({ state: 'idle', lines: null })
  }, [sourceLines])

  useEffect(() => {
    // Re-read on every Settings save: the panel stays mounted in the sidebar,
    // so a new translation language or Auto-Translate choice applies live.
    let seq = 0
    const loadSettings = () => {
      const mine = ++seq
      api.getSettings().then(s => {
        if (mine !== seq) return
        setAutoTranslate(s?.lyrics_auto_translate === '1')
        setTranslateTarget(String(s?.lyrics_translate_target || 'en'))
      }).catch(() => {})
    }
    loadSettings()
    const onSub = event => setSubline(event.detail)
    window.addEventListener('lokal:settings-saved', loadSettings)
    window.addEventListener('lokal:lyrics-subline', onSub)
    return () => {
      window.removeEventListener('lokal:settings-saved', loadSettings)
      window.removeEventListener('lokal:lyrics-subline', onSub)
    }
  }, [])

  const nonLatin = useMemo(() => hasNonLatin(lines), [lines])
  const compactLines = useMemo(() => lines.map(l => (l.gap ? { gap: true } : { text: l.text, bgText: l.bgText || null })), [lines])
  const embeddedTranslation = useMemo(() => {
    if (!result?.translationLang) return null
    if (result.translationLang === '*') return lines.map(l => l.translation || null)
    const want = translateTarget.split('-')[0].toLowerCase()
    if (result.translationLang.split('-')[0].toLowerCase() !== want) return null
    return lines.map(l => l.translation || null)
  }, [result, lines, translateTarget])
  // Apple ships a romanization track for e.g. K-pop even when a line is
  // already in English; only offer it when it actually differs somewhere.
  const embeddedRomanization = useMemo(() => (
    lines.some(l => l.romanization?.text && l.romanization.text.trim() !== l.text.trim()) ? lines.map(l => l.romanization || null) : null
  ), [lines])

  // A different target language invalidates whatever was translated before.
  useEffect(() => {
    setTranslation(t => (t.state === 'idle' || t.target === translateTarget ? t : { state: 'idle', lines: null }))
  }, [translateTarget])

  const wantTranslation = subline === 'translation' || (autoTranslate && subline === 'original' && !!result?.language && !sameLanguage(result.language, translateTarget))
  useEffect(() => {
    if (!wantTranslation || !lines.length || embeddedTranslation || translation.state !== 'idle' || !trackId) return
    setTranslation({ state: 'loading', lines: null, target: translateTarget })
    const forResult = resultRef.current
    const forTarget = translateTarget
    const forTrack = trackId
    const stale = () => resultRef.current !== forResult || trackRef.current !== forTrack
    api.translateLyrics(trackId, compactLines, translateTarget)
      .then(r => { if (!stale()) setTranslation(t => (t.target !== forTarget ? t : r?.status === 'translated' ? { state: 'ready', lines: r.lines, target: forTarget } : { state: r?.status || 'unavailable', lines: null, target: forTarget })) })
      .catch(() => { if (!stale()) setTranslation(t => (t.target !== forTarget ? t : { state: 'unavailable', lines: null, target: forTarget })) })
  }, [wantTranslation, lines.length, embeddedTranslation, translation.state, trackId, compactLines, translateTarget])

  useEffect(() => {
    if (subline !== 'romanization' || !lines.length || embeddedRomanization || romanization.state !== 'idle' || !trackId || !nonLatin) return
    setRomanization({ state: 'loading', lines: null })
    const forResult = resultRef.current
    const forTrack = trackId
    const current = () => resultRef.current === forResult && trackRef.current === forTrack
    api.romanizeLyrics?.(trackId, compactLines)
      .then(r => { if (current()) setRomanization(r?.status === 'romanized' ? { state: 'ready', lines: r.lines } : { state: r?.status || 'unavailable', lines: null }) })
      .catch(() => { if (current()) setRomanization({ state: 'unavailable', lines: null }) })
  }, [subline, lines.length, embeddedRomanization, romanization.state, trackId, nonLatin, compactLines])

  const subLines = useMemo(() => {
    if (wantTranslation) return embeddedTranslation || translation.lines
    if (subline === 'romanization') return embeddedRomanization || romanization.lines
    return null
  }, [wantTranslation, subline, embeddedTranslation, translation.lines, embeddedRomanization, romanization.lines])

  const toggle = mode => {
    const next = subline === mode ? 'original' : mode
    setSubline(next)
    writeSubline(next)
  }

  return {
    subline,
    toggle,
    subLines,
    wantTranslation,
    translateTarget,
    // 'idle' | 'loading' | 'ready' | 'same-language' | 'unavailable' (of the on-demand ones)
    translationState: translation.state,
    romanizationState: romanization.state,
    // Where the translation shown comes from: the lyrics' source, or translated here.
    translationFrom: wantTranslation ? (embeddedTranslation ? 'source' : translation.lines ? 'translated' : null) : null,
    translationBusy: wantTranslation && !embeddedTranslation && translation.state === 'loading',
    romanizationBusy: subline === 'romanization' && !embeddedRomanization && romanization.state === 'loading',
    canRomanize: nonLatin || !!embeddedRomanization,
  }
}
