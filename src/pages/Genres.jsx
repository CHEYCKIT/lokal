import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate, useParams } from 'react-router-dom'
import { Search, Tags } from 'lucide-react'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import { peekCache, writeCache, usePageReady } from '../pageCache'
import FadeImg from '../components/FadeImg'
import CoverPlay from '../components/CoverPlay'
import { plural } from '../plural'
import { useTranslation } from '../i18n'
import Library from './Library'

// Songs without any genre, as a genre of its own (see genreFilter in
// electron/ipc/scanner.js).
export const NO_GENRE = '__none__'

const genrePath = name => `/genre/${encodeURIComponent(name)}`
const artURL = item => (api.isElectron ? `file://${item.artwork_path}` : api.artworkURL(item.track_id))

/** Up to four covers of the genre's songs, as a square. */
function GenreCover({ artworks }) {
  if (!artworks?.length) {
    return <div className="flex h-full w-full items-center justify-center"><Tags size={34} className="text-muted" /></div>
  }
  if (artworks.length < 4) return <FadeImg src={artURL(artworks[0])} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2 transition-transform duration-300 group-hover:scale-[1.03]">
      {artworks.slice(0, 4).map(item => <FadeImg key={item.track_id} src={artURL(item)} alt="" className="h-full w-full object-cover" />)}
    </div>
  )
}

function GenreCard({ name, label, count, artworks, onOpen, onPlay }) {
  const { t } = useTranslation()
  const first = artworks?.[0]
  return (
    <motion.div initial={false} whileHover={{ y: -3 }}
      className="group overflow-hidden rounded-[1.5rem] border border-border bg-card/60 transition-colors hover:border-accent/35"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '320px' }}>
      <div className="relative aspect-square overflow-hidden bg-black/20">
        <GenreCover artworks={artworks} />
        <CoverPlay label={t('Play {name}', { name: label })} onPlay={onPlay} />
      </div>
      <button type="button" onClick={onOpen} className="group/open relative block w-full overflow-hidden px-4 py-3 text-left">
        <div className="absolute inset-0 scale-110 blur-xl"
          style={{ backgroundImage: first ? `url("${artURL(first)}")` : 'none', backgroundPosition: 'center', backgroundSize: 'cover', opacity: first ? 0.18 : 0 }} />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative space-y-1">
          <p className="truncate text-sm font-medium text-white decoration-white/60 underline-offset-2 group-hover/open:underline" title={label}>{label}</p>
          <p className="text-[11px] uppercase leading-snug tracking-[0.16em] text-muted/70">{plural(count, 'track')}</p>
        </div>
      </button>
    </motion.div>
  )
}

/**
 * The Genres tab: every genre in the library as a card (a song tagged
 * "Рэп/Караоке" is in both "Рэп" and "Караоке"), plus "No genre". A card
 * opens the genre's songs, sorted and filtered like the Library tab's.
 */
export default function Genres() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const playQueue = usePlayerStore(s => s.playQueue)
  const [summary, setSummaryState] = useState(() => peekCache('genres:summary') || null)
  const [query, setQuery] = useState('')
  usePageReady(!!summary)

  useEffect(() => {
    const load = () => Promise.resolve(api.getGenreSummary())
      .then(result => {
        if (!result || result.error) return
        writeCache('genres:summary', result)
        setSummaryState(result)
      })
      .catch(() => {})
    load()
    window.addEventListener('lokal:refresh', load)
    return () => window.removeEventListener('lokal:refresh', load)
  }, [])

  const shown = useMemo(() => {
    const lower = query.trim().toLocaleLowerCase()
    const list = summary?.genres || []
    return lower ? list.filter(item => item.name.toLocaleLowerCase().includes(lower)) : list
  }, [summary, query])
  const noGenre = summary?.none || 0
  const showNoGenre = noGenre > 0 && (!query.trim() || t('No genre').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  const play = async (genre) => {
    const tracks = await Promise.resolve(api.getTracks({ genre, sort: 'added_at DESC', limit: 5000 })).catch(() => null)
    if (Array.isArray(tracks) && tracks.length) playQueue(tracks, 0)
  }

  return (
    <div className="min-h-full p-6 pb-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 @md:flex-row @md:items-end @md:justify-between">
          <div>
            <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">{t('Collection')}</p>
            <h1 className="mt-2 font-display text-3xl uppercase tracking-[0.14em] text-white">{t('Genres')}</h1>
            <p className="mt-3 text-sm text-muted">{summary ? t('{n} genres', { n: (summary.genres?.length || 0).toLocaleString() }) : ' '}</p>
          </div>
          <div className="relative w-full max-w-xl">
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search genres...')}
              className="w-full rounded-2xl border border-border bg-elevated/90 pl-11 pr-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted" />
          </div>
        </div>

        {summary && !shown.length && !showNoGenre && (
          <div className="py-24 text-center text-muted">
            <Tags size={48} className="mx-auto mb-4 opacity-20" />
            <p>{query.trim() ? t('No genres match your search.') : t('No genres in your library yet.')}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3 @lg:grid-cols-4 @xl:grid-cols-5 @2xl:grid-cols-6">
          {shown.map(item => (
            <GenreCard key={item.name} name={item.name} label={item.name} count={item.count} artworks={item.artworks}
              onOpen={() => navigate(genrePath(item.name))} onPlay={() => play(item.name)} />
          ))}
          {showNoGenre && (
            <GenreCard name={NO_GENRE} label={t('No genre')} count={noGenre} artworks={[]}
              onOpen={() => navigate(genrePath(NO_GENRE))} onPlay={() => play(NO_GENRE)} />
          )}
        </div>
      </div>
    </div>
  )
}

/** /genre/:name -- one genre's songs, as the Library tab lists them. */
export function GenreTracks() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { name = '' } = useParams()
  const genre = name
  return (
    <Library key={genre} fixedGenre={genre} title={genre === NO_GENRE ? t('No genre') : genre} onBack={() => navigate('/genres')} />
  )
}
