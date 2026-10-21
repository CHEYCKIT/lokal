const os = require('os')
const events = new (require('events').EventEmitter)()

function getRemoteConnectionInfo() {
  const port = Number(process.env.PORT) || 3421
  const urls = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const info of entries || []) {
      if (!info || info.internal || info.family !== 'IPv4' || String(info.address).startsWith('169.254.')) continue
      urls.push(`http://${info.address}:${port}/remote`)
    }
  }
  const token = String(process.env.REMOTE_TOKEN || '').trim()
  // Never send the token to the external QR image provider. The remote page
  // asks for it locally when its first state request is rejected.
  const linkedUrls = [...new Set(urls)]
  const primary = linkedUrls[0] || null
  return {
    sameWifiRequired: true,
    primary,
    urls: linkedUrls,
    qrUrl: primary ? `https://quickchart.io/qr?text=${encodeURIComponent(primary)}&size=256` : null,
    tokenRequired: !!token,
  }
}

let remoteState = {
  connected: false,
  isPlaying: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  currentTrack: null,
  updatedAt: 0,
}

let remoteCommandHandler = null

function setRemoteState(state) {
  if (!state || typeof state !== 'object') return
  remoteState = {
    ...remoteState,
    ...state,
    connected: true,
    updatedAt: Date.now(),
    positionAt: Date.now(),
  }
  events.emit('state', getRemoteState())
}

function getRemoteState() {
  const elapsed = remoteState.isPlaying && remoteState.positionAt ? Math.max(0, Date.now() - remoteState.positionAt) / 1000 : 0
  return { ...remoteState, positionAt: Date.now(), progress: Math.min(Math.max(0, remoteState.duration || 0), Math.max(0, remoteState.progress || 0) + elapsed) }
}

function setRemoteCommandHandler(handler) {
  remoteCommandHandler = handler
}

async function sendRemoteCommand(command) {
  const actions=new Set(['togglePlay','play','pause','next','prev','volume','seek','toggleLike','playLibraryTrack','playNextTracks','queueTracks','setShuffle','setRepeat','playContext','reorderQueue','removeFromQueue','handoff','queueFromMetadata','playQueueIndex','clearQueue','fadePause','linkTheme','setTrackLike','applyTrackLike'])
  if(!command || !actions.has(command.action))return {error:'Unsupported remote command'}
  if(command.action==='applyTrackLike' && command._trustedLinkMutation!==true)return {error:'Unsupported remote command'}
  if(command.action==='linkTheme' && command._trustedLinkTheme!==true)return {error:'Theme sync is not enabled for this command'}
  const value=command.value
  if(command.action==='setTrackLike') {
    const id=typeof value?.trackId==='string'?value.trackId:'';
    if(!id || typeof value?.liked!=='boolean')return {error:'Invalid like command'};
    const db=require('./db').getDB(),userId=String(getRemoteState().userId||'guest');
    if(!db.prepare('SELECT id FROM tracks WHERE id=?').get(id))return {error:'This track is unavailable'};
    if(value.liked)db.prepare('INSERT OR IGNORE INTO user_likes(user_id,track_id) VALUES (?,?)').run(userId,id);
    else db.prepare('DELETE FROM user_likes WHERE user_id=? AND track_id=?').run(userId,id);
    events.emit('library',{type:'like'});
    command={action:'applyTrackLike',value,_trustedLinkMutation:true};
  }
  if(['volume','seek'].includes(command.action) && (typeof value!=='number'||!Number.isFinite(value)))return {error:'A finite numeric value is required'}
  if(command.action==='setShuffle' && typeof value!=='boolean')return {error:'Shuffle must be true or false'}
  if(command.action==='setRepeat' && !['none','one','all'].includes(value))return {error:'Unsupported repeat mode'}
  if(command.action==='reorderQueue' && (!Number.isInteger(value?.from)||!Number.isInteger(value?.to)||value.from<0||value.to<0))return {error:'Invalid queue move'}
  if(command.action==='removeFromQueue' && (!Number.isInteger(value?.index)||value.index<0))return {error:'Invalid queue entry'}
  if(command.action==='playQueueIndex' && (!Number.isInteger(value)||value<0))return {error:'Invalid queue entry'}
  if (typeof remoteCommandHandler !== 'function') {
    return { error: 'Remote command handler is not ready' }
  }
  try {
    return await remoteCommandHandler(command)
  } catch (e) {
    return { error: e.message || 'Remote command failed' }
  }
}

module.exports = {
  events,
  getRemoteConnectionInfo,
  setRemoteState,
  getRemoteState,
  setRemoteCommandHandler,
  sendRemoteCommand,
}
