import { api } from './api.js'
import { buildRecommendationMix, loadRecommendationPage, mapLimited, resolveRecommendationTracks, sourceName } from './recommendations.js'

// Discovery shelves are session-local; a manually generated Mix is durable.
const sessions = new Map()
const lastHomePaths = new Map()

export function getLastHomePath(accountId) {
  return lastHomePaths.get(String(accountId || 'guest')) || '/'
}

export function rememberHomePath(accountId, pathname) {
  const path = String(pathname || '')
  if (path === '/' || path.startsWith('/home/')) {
    lastHomePaths.set(String(accountId || 'guest'), path)
  }
  return getLastHomePath(accountId)
}

export function createRecommendationSession(client = api, { profile = 'guest', storage = globalThis.localStorage } = {}) {
  const storageKey = `lokal-recommendation-mix:${profile}`
  let savedMix
  try { savedMix = JSON.parse(storage?.getItem(storageKey) || 'null') } catch {}
  const restoredMix = savedMix?.version === 1 && Array.isArray(savedMix.mix?.tracks) && [24, 32, 40].includes(savedMix.mix.tracks.length) ? savedMix.mix : null
  let state = { account: '', source: 'lastfm', data: null, error: '', loading: false, started: false, mix: restoredMix || { size: 32, tracks: [] }, mixError: '', generating: false, tab: 'home' }
  const saveMix = () => { try { storage?.setItem(storageKey, JSON.stringify({ version: 1, mix: state.mix })) } catch {} }
  const listeners = new Set()
  let generation = 0
  let discoveryPage = 0
  let mixPage = 0
  let mixGeneration = 0
  let settingsVersion = 0
  let discoveryJob = null
  let mixJob = null
  let settingsJob = null
  const update = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
  const configure = settings => {
    const source = settings.recommendation_source === 'youtube' ? 'youtube' : 'lastfm'
    const account = JSON.stringify([source, source === 'lastfm' ? settings.lastfm_username || '' : `${settings.yt_cookie_header || ''}:${settings.yt_account_session || ''}:${settings.yt_account_revision || ''}`, settings.lastfm_enabled, source === 'lastfm' ? settings.lastfm_api_key || '' : ''])
    if (state.account === account) return false
    generation++
    discoveryPage = 0
    mixPage = 0
    discoveryJob = null
    mixJob = null
    update({ account, source, data: null, error: '', loading: false, started: false, mixError: '', generating: false })
    return true
  }
  const enrich = async (data, isCurrent, commit) => {
    if (!client.discoveryArtwork) return
    const groups = [
      ['artists', 'artist'], ['albums', 'album'], ['quickPicks', 'track'], ['liked', 'track'], ['freshFinds', 'track'], ['history', 'track'],
    ]
    await mapLimited(groups, async ([section, type]) => {
      const items = data[section] || []
      for (let at = 0; at < items.length && isCurrent(); at += 12) {
        const batch = items.slice(at, at + 12)
        const results = await client.discoveryArtwork(batch.map(item => ({ type, title: item.title, artist: type === 'artist' ? item.name : item.artist, album: item.album, image: type === 'artist' ? item.image : item.artwork_url }))).catch(() => [])
        if (!isCurrent()) return
        if (!Array.isArray(results)) continue
        const next = data[section].map((item, index) => {
          const art = results[index - at]
          return index >= at && index < at + batch.length && art?.image ? { ...item, ...(type === 'artist' ? { image: art.image } : { artwork_url: art.image }) } : item
        })
        data = { ...data, [section]: next }
        commit(data)
      }
    }, 3)
  }
  const load = (force = false) => {
    if (discoveryJob) return discoveryJob
    if (state.started && !force) return Promise.resolve(state.data)
    const version = generation
    const page = force && state.started ? ++discoveryPage : discoveryPage
    update({ loading: true, error: '', started: true })
    const isCurrent = () => generation === version && discoveryPage === page
    const job = (async () => {
      try {
        const result = await loadRecommendationPage(state.source, page, client, { force })
        if (!isCurrent()) return null
        if (!result || result.error) throw new Error(result?.error || 'Recommendation provider unavailable.')
        const previous = state.data
        const section = name => Array.isArray(result[name]) ? result[name] : previous?.[name] || []
        const data = { ...result, source: state.source, quickPicks: section('quickPicks'), liked: section('liked'), history: section('history'), artists: section('artists'), albums: section('albums'), mixes: section('mixes'), freshFinds: section('freshFinds'), updatedAt: Date.now() }
        update({ data, error: result.warnings?.length ? `Some ${sourceName(state.source)} sections could not refresh. ${result.warnings[0]}` : '' })
        // Artwork enrichment is independent of playback and survives navigation.
        enrich(data, isCurrent, next => update({ data: next })).catch(() => {})
        return data
      } catch (error) {
        if (isCurrent()) update({ error: error.message || 'Could not load recommendations.' })
        return null
      } finally {
        if (generation === version) { discoveryJob = null; update({ loading: false }) }
      }
    })()
    discoveryJob = job
    return job
  }
  const ensure = () => {
    if (settingsJob) return settingsJob
    const version = ++settingsVersion
    const job = Promise.resolve().then(() => client.getSettings()).then(settings => {
      if (version !== settingsVersion) return null
      if (!settings || settings.error) throw new Error(settings?.error || 'Could not read recommendation settings.')
      configure(settings)
      return load()
    }).catch(error => { if (version === settingsVersion) update({ error: error.message }); return null }).finally(() => { if (settingsJob === job) settingsJob = null })
    settingsJob = job
    return job
  }
  const generate = size => {
    if (mixJob) return mixJob
    const version = generation
    const mixVersion = ++mixGeneration
    const source = state.source
    const isCurrent = () => generation === version && mixGeneration === mixVersion
    update({ generating: true, mixError: '' })
    const job = (async () => {
      try {
        const tracks = await buildRecommendationMix({ size, previous: state.mix.tracks, loadPage: () => loadRecommendationPage(source, ++mixPage, client), resolve: rows => resolveRecommendationTracks(rows, client, { isCurrent }), isCurrent })
        if (isCurrent()) {
          update({ mix: { size: tracks.length, tracks, source } })
          saveMix()
          enrich({ freshFinds: tracks }, isCurrent, next => { update({ mix: { ...state.mix, tracks: next.freshFinds } }); saveMix() }).catch(() => {})
        }
        return tracks
      } catch (error) {
        if (isCurrent()) update({ mixError: error.message || 'Could not build a mix.' })
        return null
      } finally {
        if (isCurrent()) { mixJob = null; update({ generating: false }) }
      }
    })()
    mixJob = job
    return job
  }
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    ensure, refresh: () => ensure().then(() => load(true)), generate: size => ensure().then(() => generate(size)),
    setSize: size => update({ mix: { ...state.mix, size } }),
    setTab: tab => update({ tab }),
    invalidate: () => { generation++; settingsVersion++; settingsJob = null; discoveryJob = null; mixJob = null; update({ account: '', started: false, generating: false }); return ensure() },
  }
}

export function recommendationSession(profile = 'guest') {
  if (!sessions.has(profile)) sessions.set(profile, createRecommendationSession(api, { profile }))
  return sessions.get(profile)
}

if (typeof window !== 'undefined') {
  window.addEventListener('lokal:settings-saved', () => { for (const session of sessions.values()) session.ensure() })
  window.addEventListener('lokal:recommendation-access-changed', () => { for (const session of sessions.values()) session.invalidate() })
}
