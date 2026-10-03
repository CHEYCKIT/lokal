import React, { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ExternalLink, KeyRound, Music2, RefreshCw, Settings2, Youtube } from 'lucide-react'
import { api } from '../api'
import { youTubeCookieReady } from '../downloadLinks'

const GOOGLE_YOUTUBE_URL = 'https://music.youtube.com/'

function StatusDot({ connected }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-border'}`} aria-hidden="true" />
}

function ActionButton({ children, onClick, disabled = false, muted = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        muted
          ? 'border-border bg-card text-muted hover:border-accent/30 hover:text-white'
          : 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/25'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Account entry points shared by first-run setup and Integrations.
 *
 * YouTube deliberately reports the cookie-backed playback state separately
 * from the browser account hand-off. Electron cannot read cookies from an
 * external browser after shell.openExternal(), so showing that as a connected
 * account would make Premium/private playback look configured when it is not.
 */
export default function ProviderConnections({ compact = false, onOpenSettings, settingsOverride = null, disableLastfmAuth = false }) {
  const [settings, setSettings] = useState(() => settingsOverride || {})
  const [loading, setLoading] = useState(!settingsOverride)
  const [refreshing, setRefreshing] = useState(false)
  const [lastfmState, setLastfmState] = useState('')
  const [lastfmAuthorizing, setLastfmAuthorizing] = useState(false)
  const [youtubeAuthorizing, setYoutubeAuthorizing] = useState(false)
  const [youtubeState, setYoutubeState] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const lastfmAuthTimeoutRef = useRef(null)
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!settingsOverride) return
    setSettings(settingsOverride)
    settingsRef.current = settingsOverride
    setLoading(false)
  }, [settingsOverride])

  useEffect(() => {
    if (!disableLastfmAuth) return undefined
    clearTimeout(lastfmAuthTimeoutRef.current)
    lastfmAuthTimeoutRef.current = null
    setLastfmAuthorizing(false)
    setLastfmState('')
    return undefined
  }, [disableLastfmAuth, settingsOverride?.lastfm_session_key])

  const loadSettings = async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    try {
      const next = await api.getSettings()
      if (next && !next.error) {
        setSettings(next)
        settingsRef.current = next
        setSettingsError('')
      } else if (next?.error) {
        setSettingsError(next.error)
      }
    } catch (error) {
      setSettingsError(error?.message || 'Could not load account settings.')
    } finally {
      if (quiet) setRefreshing(false)
      else setLoading(false)
    }
  }

  useEffect(() => {
    if (!settingsOverride) loadSettings()
  }, [settingsOverride])

  useEffect(() => {
    if (disableLastfmAuth) return undefined
    const offAuth = api.onLastfmAuthToken?.(async (token) => {
      if (!token) return
      clearTimeout(lastfmAuthTimeoutRef.current)
      lastfmAuthTimeoutRef.current = null
      const current = settingsRef.current || {}
      if (!current.lastfm_api_key || !current.lastfm_api_secret) {
        setLastfmAuthorizing(false)
        setLastfmState('Add your Last.fm API key and secret in Settings first.')
        return
      }

      setLastfmState('Finishing Last.fm connection…')
      const result = await api.lastfmConnect(current.lastfm_api_key, current.lastfm_api_secret, token).catch(e => ({ error: e.message }))
      if (!result?.sessionKey) {
        setLastfmAuthorizing(false)
        setLastfmState(result?.error || 'Last.fm connection failed.')
        return
      }

      const patch = {
        lastfm_auth_token: token,
        lastfm_session_key: result.sessionKey,
        lastfm_username: result.username || current.lastfm_username || '',
      }
      const saved = await api.saveSettings(patch).catch(error => ({ error: error.message }))
      if (saved?.error) {
        setLastfmAuthorizing(false)
        setLastfmState(saved.error)
        return
      }
      setSettings(prev => ({ ...prev, ...patch }))
      setLastfmAuthorizing(false)
      setLastfmState(`Connected as ${patch.lastfm_username || 'Last.fm user'}`)
    })
    return () => {
      clearTimeout(lastfmAuthTimeoutRef.current)
      offAuth?.()
    }
  }, [disableLastfmAuth])

  const lastfmConnected = Boolean(settings.lastfm_session_key && settings.lastfm_username)
  const youtubePlaybackReady = youTubeCookieReady(settings)

  const authorizeLastfm = async () => {
    if (!settings.lastfm_api_key || !settings.lastfm_api_secret) {
      setLastfmState('Add your Last.fm API key and secret in Settings first.')
      onOpenSettings?.('lastfm')
      return
    }
    setLastfmAuthorizing(true)
    setLastfmState('Waiting for Last.fm authorization in your browser…')
    clearTimeout(lastfmAuthTimeoutRef.current)
    if (!disableLastfmAuth) {
      lastfmAuthTimeoutRef.current = setTimeout(() => {
        setLastfmAuthorizing(false)
        setLastfmState('Authorization timed out. Try again.')
        lastfmAuthTimeoutRef.current = null
      }, 120000)
    }
    try {
      await api.lastfmAuthorize(settings.lastfm_api_key)
    } catch (error) {
      clearTimeout(lastfmAuthTimeoutRef.current)
      lastfmAuthTimeoutRef.current = null
      setLastfmAuthorizing(false)
      setLastfmState(error?.message || 'Could not open Last.fm in your browser.')
    }
  }

  const openYouTube = async () => {
    if (!api.isElectron) {
      try {
        await api.openExternal(GOOGLE_YOUTUBE_URL)
        setYoutubeState('Sign in in your browser, then configure playback access in Settings.')
      } catch (error) {
        setYoutubeState(error?.message || 'Could not open YouTube in your browser.')
      }
      return
    }
    setYoutubeAuthorizing(true)
    setYoutubeState('Sign in to YouTube in the Lokal browser window. Close it when you are finished.')
    const result = await api.youtubeLogin().catch(error => ({ error: error.message }))
    setYoutubeAuthorizing(false)
    if (result?.ok) {
      await loadSettings(true)
      setYoutubeState(`YouTube playback access saved${result.cookieCount ? ` (${result.cookieCount} cookies)` : ''}.`)
    } else if (result?.error) {
      setYoutubeState(result.error)
    }
  }

  if (loading) {
    return <div className="rounded-xl border border-border bg-card/40 p-4 text-xs text-muted">Loading account connections…</div>
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white">Account connections</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Connect in your browser. {api.isElectron ? 'Lokal keeps provider credentials on this device and uses them only for the selected integration.' : 'Web mode sends provider credentials to the Lokal server, where they remain under that server’s control and are used only for the selected integration.'}
          </p>
          {settingsError && <p className="mt-1 text-xs text-red-400">{settingsError} <button type="button" onClick={() => loadSettings(true)} className="text-accent hover:underline">Retry</button></p>}
        </div>
        <button
          type="button"
          onClick={() => loadSettings(true)}
          disabled={refreshing}
          title="Refresh account status"
          aria-label="Refresh account status"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-card hover:text-white disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className={compact ? 'space-y-3' : 'grid gap-3 @md:grid-cols-2'}>
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-300">
                <Music2 size={16} />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Last.fm</p>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <StatusDot connected={lastfmConnected} />
                  {lastfmConnected ? `Connected as ${settings.lastfm_username}` : 'Not connected'}
                </div>
              </div>
            </div>
            {lastfmConnected && <CheckCircle2 size={16} className="text-green-400" />}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Use your Last.fm profile for scrobbling and future personalized discovery.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton onClick={authorizeLastfm} disabled={lastfmAuthorizing}>
              <ExternalLink size={13} />
              {lastfmAuthorizing ? 'Waiting…' : lastfmConnected ? 'Reconnect' : 'Authorize in Browser'}
            </ActionButton>
            {!settings.lastfm_api_key || !settings.lastfm_api_secret ? (
              <ActionButton onClick={() => onOpenSettings?.('lastfm')} muted>
                <KeyRound size={13} />
                Add API keys
              </ActionButton>
            ) : null}
          </div>
          {lastfmState && <p className={`text-xs leading-relaxed ${lastfmState.startsWith('Connected') ? 'text-green-400' : 'text-muted'}`}>{lastfmState}</p>}
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/10 text-red-300">
                <Youtube size={16} />
              </div>
              <div>
                <p className="text-sm font-medium text-white">YouTube Music</p>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <StatusDot connected={youtubePlaybackReady} />
                  {youtubePlaybackReady ? 'Playback access configured' : 'Not connected'}
                </div>
              </div>
            </div>
            {youtubePlaybackReady && <CheckCircle2 size={16} className="text-green-400" />}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {api.isElectron
              ? "Sign in to Google/YouTube in Lokal's internal browser. Lokal keeps this session separate from your other browsers and only collects YouTube-domain cookies for playback."
              : 'Open Google/YouTube in your normal browser. Web mode cannot read browser cookies, so playback access is configured separately in Settings.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton onClick={openYouTube} disabled={youtubeAuthorizing}>
              <ExternalLink size={13} />
              {youtubeAuthorizing ? 'Waiting…' : api.isElectron ? 'Sign in inside Lokal' : 'Open YouTube in Browser'}
            </ActionButton>
            <ActionButton onClick={() => onOpenSettings?.('youtube')} muted>
              <Settings2 size={13} />
              {youtubePlaybackReady ? 'Manage playback access' : 'Configure playback access'}
            </ActionButton>
          </div>
          <p className="text-[11px] leading-relaxed text-muted/80">
            {api.isElectron
              ? 'After you sign in, close the internal browser window. Lokal stores only YouTube-domain cookies locally and passes them only to yt-dlp for YouTube URLs.'
              : 'To use Premium/private playback, return to Lokal and provide a YouTube cookies.txt export in Settings. This stays local and is only passed to yt-dlp for YouTube URLs.'}
          </p>
          {youtubeState && <p className={`text-xs leading-relaxed ${youtubeState.includes('saved') ? 'text-green-400' : 'text-muted'}`}>{youtubeState}</p>}
        </div>
      </div>
    </div>
  )
}
