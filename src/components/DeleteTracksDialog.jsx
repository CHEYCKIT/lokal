// "Delete from library?" for one song, several, or whole releases.

import React, { useState } from 'react'
import { Trash2 } from 'lucide-react'
import Modal from './Modal'
import { api, peekSettings } from '../api'
import { showToast } from './Toaster'
import { plural } from '../plural'

/**
 * @param request  { tracks, title?, what? } or null (closed). `what` names
 *                 what's deleted ("3 albums"), `title` the one thing when
 *                 there is only one (a song or album name).
 * @param onDone   called with the deleted ids once they're gone
 */
export default function DeleteTracksDialog({ request, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const tracks = request?.tracks || []
  const deleteFiles = peekSettings()?.delete_files_from_disk === '1'
  const songs = plural(tracks.length, 'song')

  const confirm = async () => {
    if (!tracks.length) return
    setBusy(true)
    const ids = tracks.map(track => track.id)
    try {
      const result = await api.deleteTracks(ids)
      if (result?.error) throw new Error(result.error)
      window.dispatchEvent(new Event('lokal:refresh'))
      showToast(`Deleted ${request?.what || songs} from your library`)
      onDone?.(ids)
      onClose()
    } catch (e) {
      showToast(`Couldn't delete: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!request} onClose={busy ? () => {} : onClose} title="Delete from Library?" width="max-w-sm">
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="p-3 bg-red-500/10 rounded-full h-fit flex-shrink-0">
            <Trash2 size={20} className="text-red-400" />
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-sm text-white font-medium break-words">
              {request?.title || request?.what || songs}
              {request?.what && tracks.length ? <span className="text-muted font-normal"> · {songs}</span> : null}
            </p>
            <p className="text-xs text-muted leading-relaxed">
              {tracks.length === 1 ? 'This song' : 'These songs'} will be removed from your library, playlists, and play history.
            </p>
            <p className={`text-[10px] pt-1 ${deleteFiles ? 'text-red-300/80' : 'text-muted/60'}`}>
              {deleteFiles
                ? (api.isElectron ? 'The files will also be moved to the Recycle Bin / Trash (Settings > Library).' : 'The files will also be deleted from the server for good (Settings > Library).')
                : 'The files on your computer will NOT be deleted.'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors disabled:opacity-50">Cancel</button>
          <button onClick={confirm} disabled={busy || !tracks.length} autoFocus
            className="flex-1 py-2.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50">
            {busy ? 'Deleting…' : tracks.length > 1 ? `Delete ${tracks.length}` : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
