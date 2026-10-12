// Lokal's Cast receiver: the page the TV runs while Lokal casts to it.
//
// The TV plays the songs itself (Google's Cast framework, CAF, with this
// page's <audio>): Lokal sends them, the next few queued so the TV moves on
// with no gap. Over its own channel (urn:x-cast:app.lokal.cast) Lokal sends
// what CAF doesn't carry: the longer Up Next row, the lyrics, the view
// (Now playing or Lyrics), its accent colour, and the music video.
//
// Everything that moves is driven from the TV's own clock (the <audio>
// element), so lyrics and the video stay on the song whatever the network.
//
// ?preview opens it without CAF, for working on it in a browser: its pieces
// are then window.lokalReceiver, which preview.html feeds made-up songs.

;(function () {
  'use strict'

  var NS = 'urn:x-cast:app.lokal.cast'
  var VIDEO_INFO_MS = 6000 // the song's name over a music video, after it changes or pauses
  // Up Next slides up over the screen a moment after a song starts, near its
  // end, while paused, and when the remote's Down is pressed.
  var UP_NEXT_AFTER_START_MS = 2500
  var UP_NEXT_SHOW_MS = 9000
  var UP_NEXT_BEFORE_END_S = 20
  var LYRIC_LEAD_S = 0.2 // a line lights up just before it's sung

  var $ = function (id) { return document.getElementById(id) }
  var body = document.body
  var audio = $('audio')
  var video = $('video')
  var all = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)) }

  var state = {
    senderProtocol: 1, // the version of Lokal's messages (PROTOCOL), from the last one
    want: 'nowplaying', // Lokal's choice: 'nowplaying', 'lyrics' or 'video' (when the song has one)
    track: null, // { id, title, artist, album, image }
    playback: 'idle', // idle | playing | paused | buffering
    duration: 0,
    upnext: null, // from Lokal; null: the TV's own queue is shown
    queued: [], // the TV's own queue after the playing song (Google's fields)
    lyrics: null, // { trackId, synced, lines: [{ t, text }] }
    video: null, // { trackId, url, segments: [{ start, end, offset }], ready } (video time = song time + its segment's offset)
    clock: function () { return audio.currentTime || 0 },
  }

  // ---------------------------------------------------------------- views

  function view() {
    if (!state.track) return 'idle'
    if (state.want === 'video' && state.video && state.video.trackId === state.track.id && state.video.ready) return 'video'
    return state.want === 'lyrics' ? 'lyrics' : 'now'
  }

  var switching = null
  function applyView() {
    var next = view()
    var current = body.getAttribute('data-view')
    if (current === next) return
    var set = function () {
      body.setAttribute('data-view', next)
      if (next === 'lyrics') requestAnimationFrame(function () { lyricIndex = -2; tick(true) })
      if (next === 'video') showVideoInfo()
    }
    // Now playing ⇄ Lyrics change the layout: faded out, changed, faded back in.
    if ((current === 'now' && next === 'lyrics') || (current === 'lyrics' && next === 'now')) {
      clearTimeout(switching)
      body.classList.add('switching')
      switching = setTimeout(function () { set(); requestAnimationFrame(function () { body.classList.remove('switching') }) }, 220)
    } else set()
  }

  // ---------------------------------------------------------------- up next, over the screen

  var upNextTimer = null
  var upNextPinned = false // near the end, or paused: stays until that changes
  function showUpNext(ms) {
    clearTimeout(upNextTimer)
    body.classList.add('upnext')
    if (ms) upNextTimer = setTimeout(hideUpNext, ms)
  }
  function hideUpNext() {
    clearTimeout(upNextTimer)
    upNextPinned = false
    body.classList.remove('upnext')
  }
  function pinUpNext(on) {
    if (on === upNextPinned) return
    upNextPinned = on
    if (on) showUpNext(0)
    else hideUpNext()
  }

  function setPlayback(playback) {
    if (state.playback === playback) return
    state.playback = playback
    body.setAttribute('data-state', playback)
    if (playback === 'paused') { showVideoInfo(true); pinUpNext(true) }
    else if (playback === 'playing') { showVideoInfo(); if (upNextPinned && !nearEnd()) pinUpNext(false) }
    loop()
  }

  // ---------------------------------------------------------------- the song

  function setTrack(track) {
    var same = state.track && track && state.track.id === track.id
    state.track = track || null
    if (!track) { applyView(); return }
    $('title').textContent = track.title || ''
    $('artist').textContent = track.artist || ''
    $('album').textContent = track.album || ''
    all('.vtitle').forEach(function (el) { el.textContent = track.title || '' })
    all('.vartist').forEach(function (el) { el.textContent = track.artist || '' })
    if (!same) {
      setCover(track.image)
      paintBackdrop(track.image)
      if (state.lyrics && state.lyrics.trackId !== track.id) setLyrics(null)
      if (state.video && state.video.trackId !== track.id) setVideo(null)
      renderUpNext()
      showVideoInfo()
      // A new song: the screen first, then a look at what's next.
      hideUpNext()
      clearTimeout(upNextTimer)
      upNextTimer = setTimeout(function () { showUpNext(UP_NEXT_SHOW_MS) }, UP_NEXT_AFTER_START_MS)
    }
    applyView()
  }

  function nearEnd() {
    var d = state.duration || audio.duration || 0
    return isFinite(d) && d > 60 && d - state.clock() < UP_NEXT_BEFORE_END_S
  }

  function setCover(url) {
    var cover = $('cover')
    cover.classList.remove('on')
    if (!url) { cover.removeAttribute('src'); return }
    var img = new Image()
    img.onload = function () { if (state.track && state.track.image === url) { cover.src = url; cover.classList.add('on') } }
    img.src = url
  }

  // The cover drawn small and blurred once, then stretched over the screen.
  var layer = 0
  function paintBackdrop(url) {
    var layers = all('#backdrop .layer')
    var next = layers[layer ^ 1]
    var ctx = next.getContext('2d')
    var show = function () {
      layers[layer].classList.remove('on')
      next.classList.add('on')
      layer ^= 1
    }
    var plain = function () {
      ctx.filter = 'none'
      var gradient = ctx.createLinearGradient(0, 0, next.width, next.height)
      gradient.addColorStop(0, '#1b1b22')
      gradient.addColorStop(1, '#0b0b0d')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, next.width, next.height)
      show()
    }
    if (!url) { plain(); return }
    var img = new Image()
    img.onload = function () {
      if (!state.track || state.track.image !== url) return
      ctx.filter = 'blur(2px) saturate(1.3)'
      // Cover-fit into the 16:9 canvas, a little past its edges (the blur fades them).
      var scale = Math.max(next.width / img.width, next.height / img.height) * 1.2
      var w = img.width * scale, h = img.height * scale
      ctx.drawImage(img, (next.width - w) / 2, (next.height - h) / 2, w, h)
      show()
    }
    img.onerror = plain
    img.src = url
  }

  // ---------------------------------------------------------------- up next

  function setUpNext(items) {
    state.upnext = Array.isArray(items) ? items : null
    renderUpNext()
  }

  function renderUpNext() {
    var items = state.upnext || state.queued
    var row = $('row')
    var cards = document.createDocumentFragment()
    for (var i = 0; i < Math.min(items.length, 10); i++) {
      var item = items[i]
      var card = el('div', 'card')
      var art = el('div', 'thumb')
      if (item.image) art.style.backgroundImage = 'url("' + String(item.image).replace(/["\\\n]/g, encodeURIComponent) + '")'
      card.appendChild(art)
      card.appendChild(el('p', 't', item.title))
      card.appendChild(el('p', 'a', item.artist))
      cards.appendChild(card)
    }
    row.textContent = ''
    row.appendChild(cards)
    $('upnext').classList.toggle('has', items.length > 0)
    body.classList.toggle('has-upnext', items.length > 0)
  }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    node.className = className
    if (text) node.textContent = text
    return node
  }

  // ---------------------------------------------------------------- lyrics

  var lyricIndex = -2
  function setLyrics(lyrics) {
    state.lyrics = lyrics && lyrics.trackId ? lyrics : null
    lyricIndex = -2
    var lines = $('lines')
    var box = $('lyrics')
    lines.style.transform = 'translateY(0)'
    var list = state.lyrics ? state.lyrics.lines || [] : []
    var nodes = document.createDocumentFragment()
    for (var i = 0; i < list.length; i++) nodes.appendChild(el('p', list[i].text ? 'line' : 'line gap', list[i].text || '•••'))
    lines.textContent = ''
    lines.appendChild(nodes)
    lines.classList.toggle('plain', !!state.lyrics && !state.lyrics.synced)
    box.classList.toggle('empty', !!state.lyrics && list.length === 0)
    if (view() === 'lyrics') tick(true)
  }

  function syncLyrics(t, d) {
    var lyrics = state.lyrics
    if (!lyrics || !state.track || lyrics.trackId !== state.track.id || view() !== 'lyrics') return
    var lines = $('lines')
    var box = $('lyrics')
    var nodes = lines.children
    if (!nodes.length) return
    if (!lyrics.synced) {
      // Plain lyrics: scrolled through with the song.
      var range = Math.max(0, lines.scrollHeight - box.clientHeight * 1.4)
      var part = d > 30 ? Math.min(1, Math.max(0, (t - 10) / (d - 25))) : 0
      lines.style.transform = 'translateY(' + (-part * range) + 'px)'
      return
    }
    var index = -1
    for (var i = 0; i < lyrics.lines.length; i++) {
      if (lyrics.lines[i].t <= t + LYRIC_LEAD_S) index = i
      else break
    }
    if (index === lyricIndex) return
    lyricIndex = index
    for (var j = 0; j < nodes.length; j++) {
      nodes[j].className = 'line' + (lyrics.lines[j].text ? '' : ' gap') + (j === index ? ' now' : j < index ? ' past' : '')
    }
    var target = nodes[Math.max(0, index)]
    var offset = target.offsetTop - box.clientHeight * 0.4
    lines.style.transform = 'translateY(' + (-offset) + 'px)'
  }

  // ---------------------------------------------------------------- music video

  // Lokal sends a song's music video: { trackId, url, segments }. It plays
  // muted, kept to the song's clock (the TV's audio): it never sets the pace.
  function setVideo(info) {
    if (!info || !info.url) {
      state.video = null
      video.pause()
      video.removeAttribute('src')
      video.load()
      applyView()
      return
    }
    var segments = Array.isArray(info.segments) && info.segments.length ? info.segments : [{ start: 0, end: null, offset: 0 }]
    if (state.video && state.video.url === info.url) { state.video.segments = segments; return }
    state.video = { trackId: info.trackId, url: info.url, segments: segments, ready: false }
    video.src = info.url
    video.load()
  }

  video.addEventListener('loadeddata', function () {
    if (!state.video) return
    state.video.ready = true
    applyView()
    loop()
  })
  video.addEventListener('error', function () { if (state.video) { state.video = null; applyView() } })

  function syncVideo(t) {
    var v = state.video
    if (!v || !v.ready || !state.track || v.trackId !== state.track.id) return
    var target = null
    for (var i = 0; i < v.segments.length; i++) {
      var segment = v.segments[i]
      if (t >= segment.start && (segment.end == null || t < segment.end)) { target = t + segment.offset; break }
    }
    var end = video.duration || 0
    // Where the video doesn't have this part of the song: it waits (its picture stays).
    if (target == null || target < 0 || (end && target > end - 0.05)) { if (!video.paused) video.pause(); return }
    var drift = video.currentTime - target
    if (Math.abs(drift) > 0.4) { video.currentTime = target; video.playbackRate = 1 }
    else video.playbackRate = Math.abs(drift) > 0.05 ? 1 - Math.max(-0.05, Math.min(0.05, drift)) : 1
    var playing = state.playback === 'playing'
    if (playing && video.paused) video.play().catch(function () {})
    else if (!playing && !video.paused) video.pause()
  }

  var videoInfoTimer = null
  function showVideoInfo(stay) {
    var bar = $('vbar')
    bar.classList.add('show')
    clearTimeout(videoInfoTimer)
    if (!stay) videoInfoTimer = setTimeout(function () { if (state.playback !== 'paused') bar.classList.remove('show') }, VIDEO_INFO_MS)
  }

  // ---------------------------------------------------------------- the clock

  var shown = { fill: -1, elapsed: '', remaining: '' }
  function tick(force) {
    var t = state.clock()
    var d = state.duration || audio.duration || 0
    if (!isFinite(d)) d = 0
    var part = d > 0 ? Math.min(1, Math.max(0, t / d)) : 0
    if (force || Math.abs(part - shown.fill) > 0.0004) {
      shown.fill = part
      all('.fill').forEach(function (el) { el.style.transform = 'scaleX(' + part.toFixed(4) + ')' })
    }
    var elapsed = clockText(t)
    var remaining = d > 0 ? '-' + clockText(Math.max(0, d - t)) : ''
    if (force || elapsed !== shown.elapsed || remaining !== shown.remaining) {
      shown.elapsed = elapsed
      shown.remaining = remaining
      all('.elapsed').forEach(function (el) { el.textContent = elapsed })
      all('.remaining').forEach(function (el) { el.textContent = remaining })
    }
    syncLyrics(t, d)
    syncVideo(t)
    if (state.playback === 'playing' && !upNextPinned && nearEnd()) pinUpNext(true)
  }

  // Runs every frame only while something moves (playing), else stops.
  var frame = 0
  function loop() {
    if (frame) return
    var step = function () {
      frame = 0
      tick(false)
      if (state.playback === 'playing' || state.playback === 'buffering') frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  function clockText(seconds) {
    var s = Math.max(0, Math.floor(seconds || 0))
    var h = Math.floor(s / 3600)
    var m = Math.floor((s % 3600) / 60)
    var sec = s % 60
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec
  }

  // ---------------------------------------------------------------- Lokal's messages

  // The version of the messages on Lokal's channel this page speaks (see
  // CAST_PROTOCOL in electron/cast/controller.js). This one page serves every
  // copy of Lokal: a message says which version sent it (none: a Lokal from
  // before versions, the same as 1), so a change here can keep the old
  // messages working for Lokal that hasn't been updated yet.
  var PROTOCOL = 1

  function onMessage(data) {
    if (!data || typeof data !== 'object') return
    state.senderProtocol = Number(data.protocol) || 1
    if (data.type === 'upnext') setUpNext(data.items)
    else if (data.type === 'lyrics') setLyrics(data)
    else if (data.type === 'video') setVideo(data.url ? data : null)
    else if (data.type === 'view') {
      if (data.view) state.want = data.view === 'lyrics' || data.view === 'video' ? data.view : 'nowplaying'
      if (/^#[0-9a-f]{3,8}$/i.test(String(data.accent || ''))) document.documentElement.style.setProperty('--accent', data.accent)
      applyView()
    }
  }

  // ---------------------------------------------------------------- the TV's remote

  var tell = function () {}
  document.addEventListener('keydown', function (event) {
    if (!state.track) return
    // Down: what's next; Up: put it away.
    if (event.key === 'ArrowDown') showUpNext(UP_NEXT_SHOW_MS)
    else if (event.key === 'ArrowUp') hideUpNext()
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // Through the views: Now playing, Lyrics, the video (when there's one).
      var order = state.video ? ['nowplaying', 'lyrics', 'video'] : ['nowplaying', 'lyrics']
      var at = order.indexOf(state.want)
      state.want = order[(at + (event.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]
      applyView()
      tell({ type: 'view', view: state.want })
    }
  })

  // ---------------------------------------------------------------- Google's Cast framework

  function startCast() {
    var framework = cast.framework
    var context = framework.CastReceiverContext.getInstance()
    var player = context.getPlayerManager()
    var E = framework.events.EventType
    player.setMediaElement(audio)

    tell = function (data) { data.protocol = PROTOCOL; try { context.sendCustomMessage(NS, undefined, data) } catch (e) {} }

    var refresh = function () {
      var info = player.getMediaInformation()
      var playerState = player.getPlayerState()
      if (!info) {
        if (playerState === 'IDLE') { setTrack(null); setPlayback('idle') }
        return
      }
      var meta = info.metadata || {}
      var custom = info.customData || {}
      var images = meta.images || []
      setTrack({
        id: String(custom.trackId || info.contentId || info.contentUrl || ''),
        title: meta.title || '',
        artist: meta.artist || meta.albumArtist || '',
        album: meta.albumName || '',
        image: images.length ? images[0].url : null,
      })
      state.duration = player.getDurationSec() || info.duration || 0
      setPlayback(playerState === 'PLAYING' ? 'playing' : playerState === 'PAUSED' ? 'paused' : playerState === 'BUFFERING' ? 'buffering' : 'idle')
      // The TV's own queue, while Lokal hasn't sent its longer list.
      var queue = player.getQueueManager && player.getQueueManager()
      if (queue) {
        var items = queue.getItems() || []
        var index = queue.getCurrentItemIndex()
        state.queued = items.slice(index + 1).map(function (item) {
          var m = (item.media && item.media.metadata) || {}
          return { title: m.title || '', artist: m.artist || '', image: m.images && m.images.length ? m.images[0].url : null }
        })
        if (!state.upnext) renderUpNext()
      }
      tick(true)
    }

    player.addEventListener([E.PLAYER_LOAD_COMPLETE, E.PLAYING, E.PAUSE, E.BUFFERING, E.SEEKED, E.MEDIA_STATUS, E.ENDED], function () { refresh() })
    player.addEventListener(E.MEDIA_FINISHED, function () { setPlayback('idle') })

    context.addCustomMessageListener(NS, function (event) { onMessage(event.data) })
    // Lokal (re)connecting: it sends the Up Next row, lyrics and view again.
    context.addEventListener(framework.system.EventType.SENDER_CONNECTED, function (event) {
      try { context.sendCustomMessage(NS, event.senderId, { type: 'hello', version: 1, protocol: PROTOCOL }) } catch (e) {}
    })

    var options = new framework.CastReceiverOptions()
    options.customNamespaces = {}
    options.customNamespaces[NS] = framework.system.MessageType.JSON
    options.skipPlayersLoad = true // plain audio files and streams: no adaptive-streaming players to load
    options.statusText = 'Lokal'
    options.supportedCommands = framework.messages.Command.ALL_BASIC_MEDIA |
      framework.messages.Command.QUEUE_NEXT | framework.messages.Command.QUEUE_PREV
    context.start(options)
  }

  var preview = /[?&]preview\b/.test(location.search)
  if (!preview && window.cast && cast.framework) {
    startCast()
  } else {
    window.lokalReceiver = {
      setTrack: setTrack,
      setPlayback: setPlayback,
      setDuration: function (d) { state.duration = d; tick(true) },
      setClock: function (fn) { state.clock = fn; tick(true); loop() },
      message: onMessage,
      tick: function () { tick(true) },
      showUpNext: function () { showUpNext(0) },
      hideUpNext: hideUpNext,
    }
  }
})()
