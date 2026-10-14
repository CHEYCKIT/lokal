// Settings → Soulseek: a Soulseek account is all it takes. Lokal downloads
// the Soulseek client (slskd) the first time, runs it in the background and
// signs in; the progress and the result show here, with a check for a newer
// slskd and the update to it.

import { useTranslation } from '../i18n'
import React, { useEffect, useRef, useState } from 'react'
import { ArrowUpCircle, Check, Loader2, LogOut, RefreshCw } from 'lucide-react'
import { api } from '../api'

const LOGIN_WAIT_MS = 25000

/** Why the client isn't signed in, from its connection state. */
export function signInProblem(serverState = '', translate = value => value) {
  const state = String(serverState || '')
  if (/connecting|disconnected/i.test(state) && !/connected,/i.test(state)) {
    return translate("Can't reach the Soulseek network yet ({state}). Check your internet connection or firewall, or try again in a minute.", { state })
  }
  if (/logging ?in/i.test(state)) return translate('Soulseek is still signing you in. Try again in a moment.')
  return translate("Soulseek didn't accept the sign-in{state}. Check the username and password; if the username is taken by someone else, pick another.", { state: state ? ` (${state})` : '' })
}

export default function SoulseekSignIn({ settings, set }) {
  const { t } = useTranslation()
  const [client, setClient] = useState(null) // the client's phase: installing (progress) / starting / running / stopped / error
  const [account, setAccount] = useState(null) // slskd.status(): { loggedIn, username, serverState } | { error }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [updateCheck, setUpdateCheck] = useState(null) // null | { busy } | { upToDate } | { error }
  const [updating, setUpdating] = useState(false)
  const run = useRef(0)

  useEffect(() => {
    Promise.resolve(api.soulseekClient()).then(status => { if (status) setClient(status) }).catch(() => {})
    const off = api.onSoulseekClient(status => setClient(status))
    // Already running (searched or downloaded since Lokal opened): its account.
    Promise.resolve(api.soulseekClient()).then(status => {
      if (status?.running) Promise.resolve(api.soulseekStatus()).then(found => { if (found && !found.error) setAccount(found) }).catch(() => {})
    }).catch(() => {})
    return () => { off?.(); run.current++ }
  }, [])

  const save = values => Promise.resolve(api.saveSettings(values)).then(result => { if (result?.error) throw new Error(result.error) })

  const signIn = async () => {
    const id = ++run.current
    setBusy(true); setError(''); setAccount(null)
    try {
      await save({ soulseek_mode: 'builtin', soulseek_username: String(settings.soulseek_username || '').trim(), soulseek_password: settings.soulseek_password || '', soulseek_share_library: settings.soulseek_share_library === '1' ? '1' : '0' })
      const started = await api.soulseekConnect()
      if (started?.error) throw new Error(started.error)
      // The client is up; signing in to the Soulseek network takes a few seconds more.
      const deadline = Date.now() + LOGIN_WAIT_MS
      let status = started
      while (id === run.current && !status?.loggedIn && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        status = await api.soulseekStatus().catch(e => ({ error: e.message }))
        if (status?.error) throw new Error(status.error)
      }
      if (id !== run.current) return
      setAccount(status)
      if (!status?.loggedIn) setError(signInProblem(status?.serverState, t))
    } catch (e) {
      if (id === run.current) setError(t(e.message))
    } finally {
      if (id === run.current) setBusy(false)
    }
  }

  // Busy until the client has stopped and the password is cleared, so a quick
  // sign-in can't be stopped by this or lose the password it just saved.
  const signOut = async () => {
    run.current++
    setBusy(true); setError(''); setAccount(null)
    try {
      await api.soulseekDisconnect().catch(() => {})
      await save({ soulseek_password: '' }).catch(() => {})
      set('soulseek_password', '')
    } finally {
      setBusy(false)
    }
  }

  const checkUpdate = async () => {
    setUpdateCheck({ busy: true })
    const result = await Promise.resolve(api.soulseekCheckUpdate()).catch(e => ({ error: e.message }))
    if (result?.error) setUpdateCheck({ error: result.error })
    else setUpdateCheck(result?.update ? null : { upToDate: true })
    Promise.resolve(api.soulseekClient()).then(status => { if (status) setClient(status) }).catch(() => {})
  }

  const update = async () => {
    // Signed in again by the new version once it's in (or the old one, if the update fails).
    setUpdating(true); setUpdateCheck(null); setError(''); setAccount(null)
    const result = await Promise.resolve(api.soulseekUpdate()).catch(e => ({ error: e.message }))
    if (result?.error) setUpdateCheck({ error: result.error })
    else if (result) setClient(result)
    const now = await Promise.resolve(api.soulseekClient()).catch(() => null)
    if (now?.running) await Promise.resolve(api.soulseekStatus()).then(found => { if (found && !found.error) setAccount(found) }).catch(() => {})
    setUpdating(false)
  }

  const phase = client?.phase
  const working = busy && (phase === 'installing' || phase === 'starting' || !account)
  const progressText = phase === 'updating'
    ? t('Updating the Soulseek client to slskd {version}… {percent}%', { version: client.update?.version || '', percent: client.progress || 0 })
    : phase === 'installing'
    ? t('Downloading the Soulseek client (slskd {version}, once)… {percent}%', { version: client.version, percent: client.progress || 0 })
    : phase === 'starting' ? t('Starting the Soulseek client…') : t('Signing in to Soulseek…')
  const signedIn = !!account?.loggedIn

  return (
    <div className="space-y-3">
      <div className="grid gap-2 @md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted">{t("Username")}</span>
          <input value={settings.soulseek_username || ''} onChange={e => set('soulseek_username', e.target.value)} disabled={busy}
            spellCheck={false} autoComplete="username" placeholder={t("Your Soulseek username")}
            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50 disabled:opacity-60" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">{t("Password")}</span>
          <input type="password" value={settings.soulseek_password || ''} onChange={e => set('soulseek_password', e.target.value)} disabled={busy}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) signIn() }}
            autoComplete="current-password" placeholder={t("Its password")}
            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50 disabled:opacity-60" />
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">{t("New to Soulseek? Make up a username and password: the account is created the first time you sign in. Use one that isn't signed in anywhere else (Nicotine+, another slskd) at the same time.")}</p>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-muted">
        <input type="checkbox" checked={settings.soulseek_share_library === '1'} disabled={busy || !settings.music_folder}
          onChange={e => set('soulseek_share_library', e.target.checked ? '1' : '0')} className="mt-0.5 accent-[rgb(var(--accent-rgb))]" />
        <span>{t('Share my music folder{path} with the Soulseek network. Many Soulseek users only send files to people who share; takes effect at the next sign-in.', { path: settings.music_folder ? ` (${settings.music_folder})` : '' })}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={signIn} disabled={busy || updating || !String(settings.soulseek_username || '').trim() || !settings.soulseek_password} aria-label={t("Sign in to Soulseek")}
          className="inline-flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/20 px-4 py-1.5 text-xs font-display uppercase tracking-wider text-accent disabled:opacity-50">
          {busy && <Loader2 size={12} className="animate-spin" />}{signedIn ? t('Sign in again') : t('Sign in')}
        </button>
        {(signedIn || client?.running) && !updating && (
          <button onClick={signOut} aria-label={t("Sign out of Soulseek")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-white">
            <LogOut size={12} /> {t('Sign out of Soulseek')}
          </button>
        )}
        {(working || updating) && <p role="status" className="text-xs text-muted">{progressText}</p>}
        {!busy && signedIn && <p role="status" className="inline-flex items-center gap-1.5 text-xs text-green-400"><Check size={12} />{t('Signed in as {username} · slskd {version}', { username: account.username || settings.soulseek_username, version: account.version || client?.version })}</p>}
        {!busy && !updating && (error || (phase === 'error' && client?.error)) && <p role="alert" className="text-xs text-red-400">{t(error || client.error)}</p>}
      </div>
      {client?.installed && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>{t('Soulseek client: slskd {version}', { version: client.version })}</span>
          {client.update ? (
            <>
              <button onClick={update} disabled={busy || updating} aria-label={t('Update slskd to {version}', { version: client.update.version })}
                className="inline-flex items-center gap-1 rounded-md border border-accent/50 bg-accent/15 px-2 py-0.5 text-accent hover:bg-accent/25 disabled:opacity-50">
                {updating ? <Loader2 size={11} className="animate-spin" /> : <ArrowUpCircle size={11} />}{t('Update to {version}', { version: client.update.version })}
              </button>
              <button onClick={() => api.openExternal(client.update.notes)} className="hover:text-white hover:underline">{t("What's new")}</button>
            </>
          ) : (
            <button onClick={checkUpdate} disabled={busy || updating || updateCheck?.busy} className="inline-flex items-center gap-1 hover:text-white disabled:opacity-50">
              <RefreshCw size={11} className={updateCheck?.busy ? 'animate-spin' : ''} />{updateCheck?.busy ? t('Checking…') : t('Check for updates')}
            </button>
          )}
          {updateCheck?.upToDate && <span role="status" className="inline-flex items-center gap-1 text-green-400"><Check size={11} />{t("Up to date")}</span>}
          {updateCheck?.error && <span role="alert" className="text-red-400">{t(updateCheck.error)}</span>}
          {client.update && client.running && !updating && <span>{t("Updating restarts Soulseek; Soulseek downloads in progress are interrupted.")}</span>}
        </div>
      )}
      {(phase === 'installing' || phase === 'updating') && (
        <div className="h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${client.progress || 0}%` }} /></div>
      )}
    </div>
  )
}
