// What to know before downloading, where downloads start (a pasted link, the
// online results): once, that only what you're allowed to save should be
// saved; and, for YouTube, that a cookie is needed until one is set up.

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Cookie, X } from 'lucide-react'
import { api, peekSettings } from '../api'
import { COOKIE_HINT_KEY, DISCLAIMER_KEY, youTubeCookieReady } from '../downloadLinks'

const read = (key) => { try { return localStorage.getItem(key) === '1' } catch { return false } }
const remember = (key) => { try { localStorage.setItem(key, '1') } catch {} }

/** Is a YouTube cookie set up (follows Settings as it's saved)? */
function useCookieReady() {
  const [ready, setReady] = useState(() => (peekSettings() ? youTubeCookieReady(peekSettings()) : true))
  useEffect(() => {
    const check = () => Promise.resolve(api.getSettings()).then(s => { if (s && !s.error) setReady(youTubeCookieReady(s)) }).catch(() => {})
    check()
    window.addEventListener('lokal:settings-saved', check)
    return () => window.removeEventListener('lokal:settings-saved', check)
  }, [])
  return ready
}

/**
 * @param youtube  downloading from YouTube here (shows the cookie hint when needed)
 */
export default function DownloadNotices({ youtube = false }) {
  const nav = useNavigate()
  const cookieReady = useCookieReady()
  const [accepted, setAccepted] = useState(() => read(DISCLAIMER_KEY))
  const [cookieDismissed, setCookieDismissed] = useState(() => read(COOKIE_HINT_KEY))
  const showCookie = youtube && !cookieReady && !cookieDismissed
  if (accepted && !showCookie) return null

  return (
    <div className="space-y-2">
      {!accepted && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.07] px-3.5 py-2.5">
          <AlertTriangle size={14} className="flex-shrink-0 text-yellow-300" />
          <p className="min-w-0 flex-1 text-xs text-muted">
            <span className="text-yellow-100">Downloads use yt-dlp.</span> Only download what you own or are allowed to save; copyright rules depend on where you are and the source.
          </p>
          <button onClick={() => { remember(DISCLAIMER_KEY); setAccepted(true) }}
            className="flex-shrink-0 rounded-lg bg-yellow-500/15 px-2.5 py-1 text-[11px] font-semibold text-yellow-100 transition-colors hover:bg-yellow-500/25">
            Got it
          </button>
        </div>
      )}
      {showCookie && (
        <div className="flex items-center gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/[0.07] px-3.5 py-2.5">
          <Cookie size={14} className="flex-shrink-0 text-yellow-300" />
          <p className="min-w-0 flex-1 text-xs text-muted">
            <span className="text-yellow-100">Set up your YouTube cookie</span>: without it YouTube often refuses downloads ("confirm you're not a bot"). Settings → Library → Use YouTube Cookies.
          </p>
          <button onClick={() => nav('/settings')}
            className="flex-shrink-0 rounded-lg bg-yellow-500/15 px-2.5 py-1 text-[11px] font-semibold text-yellow-100 transition-colors hover:bg-yellow-500/25">
            Set up
          </button>
          <button onClick={() => { remember(COOKIE_HINT_KEY); setCookieDismissed(true) }} title="Don't show again" aria-label="Don't show again"
            className="flex-shrink-0 p-0.5 text-muted transition-colors hover:text-white">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
