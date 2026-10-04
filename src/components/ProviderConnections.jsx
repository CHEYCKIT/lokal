import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CheckCircle2, ExternalLink, KeyRound, Music2, RefreshCw, Youtube } from 'lucide-react'
import { api } from '../api'
import { getYoutubeAccountStatus, subscribeYoutubeAccountStatus } from '../youtubeAccountStatus'

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
 * Desktop YouTube Music sign-in owns a persistent, automatically refreshed session.
 */
export default function ProviderConnections({ compact = false, onOpenSettings, settingsOverride = null, disableLastfmAuth = false, onYouTubeSettingsChanged }) {
  const [settings, setSettings] = useState(() => settingsOverride || {})
  const [loading, setLoading] = useState(!settingsOverride)
  const [refreshing, setRefreshing] = useState(false)
  const [lastfmState, setLastfmState] = useState('')
  const [lastfmAuthorizing, setLastfmAuthorizing] = useState(false)
  const [youtubeAuthorizing, setYoutubeAuthorizing] = useState(false)
  const [youtubeSigningIn, setYoutubeSigningIn] = useState(false)
  const [youtubeState, setYoutubeState] = useState({ message: '', tone: 'muted' })
  const [settingsError, setSettingsError] = useState('')
  const youtubeStatus = useSyncExternalStore(subscribeYoutubeAccountStatus, getYoutubeAccountStatus)
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
        onYouTubeSettingsChanged?.(Object.fromEntries(Object.entries(next).filter(([key]) => key.startsWith('yt_'))))
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
  const youtubeAccountReady = settings.yt_account_session === '1'
  const youtubeConnected = youtubeAccountReady && youtubeStatus.verified && youtubeStatus.connected
  useEffect(() => api.onYoutubeSignInStatus(status => {
    if (status?.message) setYoutubeState({ message: status.message, tone: 'muted' })
  }), [])
  const verifyYouTube = async () => {
    setYoutubeAuthorizing(true)
    const result = await api.youtubeAccount(true).catch(error => ({ error: error.message }))
    setYoutubeAuthorizing(false)
    const verified = result?.authenticated === true && !result.error
    setYoutubeState({ message: verified ? 'YouTube Music account access verified.' : result?.error || 'YouTube Music did not confirm account access. Please sign in again.', tone: verified ? 'success' : 'error' })
  }
  const signInYouTube = async () => {
    setYoutubeAuthorizing(true)
    setYoutubeSigningIn(true)
    setYoutubeState({ message: 'Opening YouTube Music in an isolated Lokal window. Use Sign in on that page; account verification is automatic.', tone: 'muted' })
    try {
      const result = await api.youtubeSignIn({ mode: 'embedded' })
      await loadSettings(true)
      const verified = result?.authenticated === true && !result.error
      setYoutubeState({ message: verified ? 'YouTube Music account access verified.' : result?.error || 'Sign-in was closed before account access could be verified. Please sign in again.', tone: verified ? 'success' : 'error' })
    } catch (error) { setYoutubeState({ message: error.message || 'YouTube Music sign-in failed.', tone: 'error' }) }
    finally { setYoutubeAuthorizing(false); setYoutubeSigningIn(false) }
  }

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

  const disconnectYouTube = async () => {
    if (!window.confirm('Disconnect YouTube Music and sign out of its saved session?')) return
    setYoutubeAuthorizing(true)
    try {
      const result = await api.youtubeDisconnect()
      if (!result?.ok || result.error) throw new Error(result?.error || 'Could not disconnect YouTube Music.')
      await loadSettings(true)
      setYoutubeState({ message: 'YouTube disconnected from Lokal.', tone: 'success' })
      window.dispatchEvent(new Event('lokal:refresh'))
    } catch (error) { setYoutubeState({ message: error.message || 'Could not disconnect YouTube Music.', tone: 'error' }) }
    finally { setYoutubeAuthorizing(false) }
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
            {api.isElectron ? 'Lokal keeps provider credentials on this device and uses them only for the selected integration.' : 'Web mode sends provider credentials to the Lokal server, where they remain under that server’s control and are used only for the selected integration.'}
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
            <ActionButton onClick={authorizeLastfm} disabled={lastfmAuthorizing || disableLastfmAuth}>
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
                  <StatusDot connected={youtubeConnected} />
                  {youtubeConnected ? 'Account access verified' : youtubeAccountReady ? youtubeStatus.error ? 'Saved session needs reconnecting' : 'Session saved · not verified' : 'Account not connected'}
                </div>
              </div>
            </div>
            {youtubeConnected && <CheckCircle2 size={16} className="text-green-400" />}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {api.isElectron ? 'YouTube Music opens in an isolated Lokal window. Use the website’s Sign in button. Lokal keeps the full browser session after Music confirms account access and restores it when the app restarts.' : 'YouTube Music sign-in is available in the desktop app.'}
          </p>
          {api.isElectron && <div className="flex flex-wrap gap-2"><ActionButton onClick={signInYouTube} disabled={youtubeAuthorizing}>{youtubeAuthorizing ? <RefreshCw size={13} className="animate-spin" /> : <Youtube size={13} />}Sign in to YouTube Music</ActionButton>{youtubeSigningIn && <ActionButton onClick={() => api.youtubeCancelSignIn()} muted>Cancel sign-in</ActionButton>}</div>}
          <div className="flex flex-wrap items-center gap-2">
              {youtubeAccountReady && <ActionButton onClick={verifyYouTube} disabled={youtubeAuthorizing} muted>Verify account access</ActionButton>}
              {youtubeAccountReady && <ActionButton onClick={disconnectYouTube} disabled={youtubeAuthorizing} muted>Disconnect</ActionButton>}
          </div>
          {youtubeState.message && <p className={`text-xs leading-relaxed ${youtubeState.tone === 'success' ? 'text-green-400' : youtubeState.tone === 'error' ? 'text-red-300' : 'text-muted'}`}>{youtubeState.message}</p>}
          {!youtubeState.message && youtubeStatus.error && <p className="text-xs leading-relaxed text-red-300">{youtubeStatus.error}</p>}
        </div>
      </div>
    </div>
  )
}
