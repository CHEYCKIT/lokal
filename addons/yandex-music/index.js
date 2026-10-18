// Yandex Music provider for Lokal's SpotiFLAC-compatible package runtime.
// Audio signature/decryption flow adapted from the MIT-licensed yandex-music-downloader:
// https://gitcode.com/gh_mirrors/ya/yandex-music-downloader
// This provider uses the user's own OAuth token; availability/quality still follows the account.

var API_BASE = "https://api.music.yandex.net";
var FILE_INFO_SIGN_KEY = "p93jhgh689SBReK6ghtw62";
var CODECS = ["flac", "flac-mp4", "mp3", "aac", "he-aac", "aac-mp4", "he-aac-mp4"];
var DEFAULT_CLIENT = "YandexMusicAndroid/24023621";
var config = { token: "" };

/** Initializes provider settings and normalizes the OAuth token. */
function initialize(values) {
  values = values || {};
  config.token = String(values.token || (typeof settings === "object" && settings.token) || "").trim().replace(/^OAuth\s+/i, "");
  return true;
}
/** Builds authenticated headers for Yandex Music API requests. */
function requestHeaders() {
  if (!config.token) throw new Error("Set your Yandex Music OAuth token in Settings → Addons → Yandex Music.");
  return {"Authorization": "OAuth " + config.token, "X-Yandex-Music-Client": DEFAULT_CLIENT, "Accept": "application/json"};
}
/** Fetches and validates a JSON response from the Yandex Music API. */
function requestJson(path) {
  var response = http.get(API_BASE + path, requestHeaders());
  if (!response) throw new Error("Yandex Music did not return a response.");
  if (response.error && !response.statusCode && !response.status) throw new Error(String(response.error || "Yandex Music request failed"));
  var status = Number(response.statusCode || response.status || 0);
  var body = String(response.body || ""), data = null;
  try { data = JSON.parse(body); } catch (_) { if (status >= 200 && status < 300) throw new Error("Yandex Music returned invalid JSON."); }
  if (status < 200 || status >= 300) {
    var detail = data && (data.message || data.error || data.name) || body;
    if (status === 401 || status === 403) throw new Error("Yandex Music refused access (HTTP " + status + "). Check the OAuth token and your account's access to this track.");
    throw new Error("Yandex Music request failed (HTTP " + status + ")" + (detail ? ": " + String(detail).slice(0, 180) : ""));
  }
  if (data && data.error) throw new Error("Yandex Music: " + String(data.error.message || data.error.name || JSON.stringify(data.error)).slice(0, 180));
  return data && data.result !== undefined ? data.result : data;
}
/** Encodes non-null parameters into a URL query string. */
function pathQuery(values) {
  var pairs = [];
  for (var key in values) if (Object.prototype.hasOwnProperty.call(values, key) && values[key] != null) pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(values[key])));
  return pairs.join("&");
}
/** Extracts a result array from common API response shapes. */
function listFrom(value, keys) {
  if (Array.isArray(value)) return value;
  value = value || {};
  for (var i = 0; i < keys.length; i++) {
    if (Array.isArray(value[keys[i]])) return value[keys[i]];
    if (value[keys[i]] && Array.isArray(value[keys[i]].results)) return value[keys[i]].results;
  }
  return [];
}
/** Converts a Yandex image reference to an HTTPS image URL. */
function apiImage(value) {
  if (!value) return null;
  if (typeof value === "object") value = value.uri || value.url || value.src || "";
  var url = String(value || "").trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url.replace(/%%/g, "1000x1000").replace(/^http:\/\//i, "https://");
  return "https://" + url.replace(/^\/+/, "").replace(/%%/g, "1000x1000");
}
/** Normalizes and deduplicates artist/name values into strings. */
function namesOf(values) {
  if (!Array.isArray(values)) return values ? [String(values)] : [];
  var result = [];
  for (var i = 0; i < values.length; i++) {
    var item = values[i], name = typeof item === "string" ? item : item && (item.name || item.title);
    if (name && result.indexOf(String(name)) < 0) result.push(String(name));
  }
  return result;
}
/** Converts a present identifier to a string, or returns null. */
function idOf(value) { return value == null || value === "" ? null : String(value); }
/** Returns album metadata from a track or fallback record. */
function albumOfTrack(track, fallback) {
  if (track && Array.isArray(track.albums) && track.albums.length) return track.albums[0] || {};
  if (track && track.album && typeof track.album === "object") return track.album;
  if (track && track.album && typeof track.album === "string") return {title: track.album, id: track.album_id || track.albumId};
  return fallback || {};
}
/** Normalizes a Yandex track record for Lokal. */
function trackOf(track, fallbackAlbum) {
  if (track && track.track && typeof track.track === "object") track = track.track;
  track = track || {};
  var album = albumOfTrack(track, fallbackAlbum);
  var artistValues = Array.isArray(track.artists) && track.artists.length ? track.artists : Array.isArray(album.artists) ? album.artists : track.artist ? [track.artist] : [];
  var artists = [];
  for (var i = 0; i < artistValues.length; i++) {
    var value = artistValues[i], name = typeof value === "string" ? value : value && (value.name || value.title);
    if (name) artists.push({id: idOf(value && typeof value === "object" ? value.id : null), name: String(name)});
  }
  var albumName = album.title || album.name || album.album_name || album.albumName || track.album_name || (typeof track.album === "string" ? track.album : "");
  var albumId = album.id || album.albumId || album.album_id || track.albumId || track.album_id;
  var cover = apiImage(album.coverUri || album.cover_uri || album.coverUrl || album.cover_url || track.coverUri || track.cover_uri || track.cover_url || track.ogImage || track.og_image);
  var durationMs = Number(track.durationMs || track.duration_ms || track.duration || 0);
  if (durationMs > 0 && durationMs < 1000) durationMs *= 1000;
  var position = album.trackPosition || album.track_position || track.trackPosition || track.track_position || {};
  var year = album.year || String(album.releaseDate || album.release_date || track.releaseDate || track.release_date || "").slice(0, 4);
  return {
    id: idOf(track.id || track.trackId || track.track_id),
    name: String(track.title || track.name || "").trim(),
    title: String(track.title || track.name || "").trim(),
    item_type: "track", artists: artists, artist: namesOf(artists).join(", "),
    artist_id: artists.length ? artists[0].id : idOf(album.artistId || album.artist_id),
    album: String(albumName || ""), album_name: String(albumName || ""),
    album_id: idOf(albumId), albumId: idOf(albumId),
    album_artist: namesOf(album.artists || []).join(", "),
    track_number: Number(position.index || position.trackNumber || track.trackNumber || track.track_number) || null,
    disc_number: Number(position.volume || position.discNumber || track.discNumber || track.disc_number) || null,
    total_tracks: Number(album.trackCount || album.track_count || album.totalTracks || album.total_tracks) || null,
    duration_ms: durationMs || null, duration: durationMs || null,
    release_date: String(album.releaseDate || album.release_date || year || ""),
    cover_url: cover, artwork_url: cover, isrc: track.isrc || null,
    explicit: track.explicit === true || !!track.contentWarning, provider_id: "yandex-music"
  };
}
/** Normalizes a Yandex album record for Lokal. */
function albumOf(album) {
  album = album || {};
  var artists = Array.isArray(album.artists) ? album.artists : [], firstArtist = artists.length ? artists[0] : {};
  var date = album.releaseDate || album.release_date || "";
  var cover = apiImage(album.coverUri || album.cover_uri || album.ogImage || album.og_image || album.cover);
  return {
    id: idOf(album.id || album.albumId), name: String(album.title || album.name || ""), title: String(album.title || album.name || ""),
    item_type: "album", artists: namesOf(artists), artist: namesOf(artists).join(", "),
    artist_id: idOf(firstArtist && firstArtist.id), cover_url: cover, artworkURL: cover,
    release_date: String(date || album.year || ""), album_type: String(album.type || album.albumType || album.releaseType || "album"),
    total_tracks: Number(album.trackCount || album.track_count || album.trackCountWithPopularTracks) || null
  };
}
/** Normalizes a Yandex artist record for Lokal. */
function artistOf(artist) {
  artist = artist || {};
  var cover = artist.cover || {};
  var image = apiImage(cover.uri || cover.url || artist.coverUri || artist.cover_uri || artist.ogImage || artist.og_image || artist.opImage || artist.op_image);
  return {id: idOf(artist.id || artist.artistId), name: String(artist.name || artist.title || ""), item_type: "artist", cover_url: image, image_url: image};
}
/** Runs a type-specific catalogue search. */
function searchResult(query, filter) {
  var type = filter === "albums" || filter === "album" ? "album" : filter === "artists" || filter === "artist" ? "artist" : "track";
  return requestJson("/search?" + pathQuery({text: String(query || "").trim(), type: type, page: 0})) || {};
}
/** Searches for track results and normalizes them for Lokal. */
function searchTracks(query, limit) {
  var result = searchResult(query, "tracks"), items = listFrom(result.tracks || result, ["results"]), tracks = [];
  var max = Math.max(1, Math.min(100, Number(limit) || 20));
  for (var i = 0; i < items.length && tracks.length < max; i++) if (items[i] && items[i].id != null && (items[i].title || items[i].name)) tracks.push(trackOf(items[i]));
  return tracks;
}
/** Searches tracks, albums, or artists using the selected filter. */
function customSearch(query, options) {
  options = options || {};
  var filter = String(options.filter || "tracks"), max = Math.max(1, Math.min(100, Number(options.limit) || 20));
  var result = searchResult(query, filter);
  if (filter === "albums" || filter === "album") return {tracks: listFrom(result.albums || result, ["results"]).slice(0, max).map(albumOf)};
  if (filter === "artists" || filter === "artist") return {tracks: listFrom(result.artists || result, ["results"]).slice(0, max).map(artistOf)};
  return {tracks: listFrom(result.tracks || result, ["results"]).slice(0, max).map(function (track) { return trackOf(track); })};
}
/** Fetches one track by ID and throws when it cannot be found. */
function getTrack(id) {
  var result = requestJson("/tracks?" + pathQuery({"track-ids": String(id)}));
  var rows = listFrom(result, ["tracks", "results"]);
  if (!rows.length && result && result.id != null) rows = [result];
  if (!rows.length) throw new Error("Yandex Music track was not found: " + String(id));
  return trackOf(rows[0]);
}
/** Fetches track IDs in bounded batches to avoid serial album lookups. */
function getTracks(ids) {
  var tracks = [], batchSize = 50, maxIds = ids.slice(0, 300);
  for (var start = 0; start < maxIds.length; start += batchSize) {
    var batch = maxIds.slice(start, start + batchSize), response;
    try {
      response = requestJson("/tracks?" + pathQuery({"track-ids": batch.join(",")}));
    } catch (_) {
      continue;
    }
    var fetched = listFrom(response, ["tracks", "results"]), byId = Object.create(null);
    for (var i = 0; i < fetched.length; i++) {
      var row = fetched[i] && fetched[i].track && typeof fetched[i].track === "object" ? fetched[i].track : fetched[i];
      var id = row && (row.id != null ? row.id : row.trackId != null ? row.trackId : row.track_id);
      if (id != null) byId[String(id)] = row;
    }
    for (var j = 0; j < batch.length; j++) {
      var found = byId[String(batch[j])];
      if (found) tracks.push(found);
    }
  }
  return tracks;
}
/** Extracts flat track records from album volumes and ID lists. */
function flattenTracks(albumResult) {
  albumResult = albumResult || {};
  var rows = [];
  /** Collects track records from nested album volume arrays. */
  function walk(value) {
    if (!Array.isArray(value)) return;
    for (var i = 0; i < value.length; i++) {
      var row = value[i];
      if (Array.isArray(row)) walk(row);
      else if (row && typeof row === "object") rows.push(row.track && typeof row.track === "object" ? row.track : row);
    }
  }
  if (Array.isArray(albumResult.volumes)) walk(albumResult.volumes);
  if (Array.isArray(albumResult.tracks)) walk(albumResult.tracks);
  if (!rows.length && Array.isArray(albumResult.trackIds)) rows = getTracks(albumResult.trackIds);
  return rows;
}
/** Fetches an album and returns its normalized track listing. */
function getAlbum(id) {
  var albumResult = requestJson("/albums/" + encodeURIComponent(String(id)) + "/with-tracks");
  if (!albumResult || albumResult.id == null) throw new Error("Yandex Music album was not found: " + String(id));
  var album = albumOf(albumResult), rawTracks = flattenTracks(albumResult), tracks = [];
  for (var i = 0; i < rawTracks.length; i++) {
    var item = trackOf(rawTracks[i], albumResult);
    if (item.id && item.name) tracks.push(item);
  }
  if (!tracks.length) throw new Error("Yandex Music returned no tracks for this album.");
  album.tracks = tracks; album.album_id = album.id;
  return album;
}
/** Fetches an artist with album and top-track listings. */
function getArtist(id) {
  var artistResult = requestJson("/artists/" + encodeURIComponent(String(id))) || {};
  var albumsResult = {}, tracksResult = {};
  try { albumsResult = requestJson("/artists/" + encodeURIComponent(String(id)) + "/direct-albums?" + pathQuery({page: 0, "page-size": 100, "sort-by": "year"})) || {}; } catch (_) {}
  try { tracksResult = requestJson("/artists/" + encodeURIComponent(String(id)) + "/tracks?" + pathQuery({page: 0, "page-size": 50})) || {}; } catch (_) {}
  var albumsRaw = listFrom(albumsResult, ["albums", "results"]), tracksRaw = listFrom(tracksResult, ["tracks", "results"]), albums = [], tracks = [];
  for (var i = 0; i < albumsRaw.length; i++) { var album = albumOf(albumsRaw[i]); if (album.id && album.name) albums.push(album); }
  for (var j = 0; j < tracksRaw.length; j++) { var track = trackOf(tracksRaw[j]); if (track.id && track.name) tracks.push(track); }
  var artist = artistOf(artistResult);
  artist.albums = albums; artist.top_tracks = tracks; artist.tracks = tracks;
  return artist;
}
/** Resolves supported Yandex Music links into track listings. */
function handleUrl(raw) {
  var text = String(raw || "").trim();
  var trackMatch = text.match(/\/album\/(\d+)(?:\/track\/(\d+))?/i);
  if (trackMatch && trackMatch[2]) {
    var track = getTrack(trackMatch[2]);
    if (!track.album_id) track.album_id = track.albumId = trackMatch[1];
    return {tracks: [track]};
  }
  var bareTrackMatch = text.match(/\/track\/(\d+)(?:[/?#]|$)/i);
  if (bareTrackMatch) return {tracks: [getTrack(bareTrackMatch[1])]};
  var albumMatch = text.match(/\/album\/(\d+)(?:[/?#]|$)/i);
  if (albumMatch) return {tracks: getAlbum(albumMatch[1]).tracks};
  var artistMatch = text.match(/\/artist\/(\d+)(?:[/?#]|$)/i);
  if (artistMatch) return {tracks: getArtist(artistMatch[1]).top_tracks || []};
  return {tracks: []};
}
/** Requests signed downloadable audio URLs for a track. */
function getDownloadInfo(trackId, requestedQuality) {
  var quality = requestedQuality === "lossless" ? "lossless" : "nq";
  var timestamp = Math.floor(Date.now() / 1000), codecs = CODECS.join(",");
  var message = String(timestamp) + String(trackId) + quality + CODECS.join("") + "encraw";
  var sign = String(utils.hmacSHA256Base64(message, FILE_INFO_SIGN_KEY) || "").replace(/=$/, "");
  var params = pathQuery({ts: timestamp, trackId: trackId, quality: quality, codecs: codecs, transports: "encraw", sign: sign});
  var response = requestJson("/get-file-info?" + params);
  var info = response && (response.downloadInfo || response.download_info || response);
  if (!info || !Array.isArray(info.urls) || !info.urls.length) throw new Error("Yandex Music supplied no downloadable audio for this track.");
  return info;
}
/** Maps a Yandex codec to its file extension and conversion needs. */
function outputFormat(codec) {
  codec = String(codec || "").toLowerCase();
  if (codec === "flac") return {extension: ".flac", requiresConversion: false};
  if (codec === "flac-mp4") return {extension: ".m4a", requiresConversion: true};
  if (codec === "mp3") return {extension: ".mp3", requiresConversion: false};
  if (codec === "aac" || codec === "he-aac") return {extension: ".aac", requiresConversion: false};
  if (codec === "aac-mp4" || codec === "he-aac-mp4") return {extension: ".m4a", requiresConversion: false};
  throw new Error("Yandex Music returned an unsupported audio codec: " + codec);
}
/** Creates the AES-CTR counter IV for a block index. */
function counterIV(blockIndex) {
  var value = Math.max(0, Math.floor(Number(blockIndex) || 0)), iv = new Uint8Array(16);
  iv[12] = (value >>> 24) & 255; iv[13] = (value >>> 16) & 255; iv[14] = (value >>> 8) & 255; iv[15] = value & 255;
  return iv;
}
/** Decrypts an encrypted audio file in bounded chunks. */
function decryptFile(sourcePath, destinationPath, keyHex, onProgress) {
  var sizeInfo = file.getSize(sourcePath);
  if (!sizeInfo || !sizeInfo.success || !Number(sizeInfo.size)) throw new Error("Could not read the downloaded Yandex Music audio.");
  var size = Number(sizeInfo.size), chunkSize = 8 * 1024 * 1024;
  for (var offset = 0; offset < size; offset += chunkSize) {
    if (utils.isDownloadCancelled()) throw new Error("Yandex Music download cancelled.");
    var length = Math.min(chunkSize, size - offset), read = file.readBytes(sourcePath, {offset: offset, length: length, encoding: "bytes"});
    if (!read || !read.success || !read.data) throw new Error("Could not read encrypted Yandex Music audio.");
    var encrypted = new Uint8Array(read.data);
    var decoded = utils.decryptBlockCipher(encrypted, {
      algorithm: "aes", mode: "ctr", key: String(keyHex), keyEncoding: "hex", iv: counterIV(offset / 16),
      ivEncoding: "bytes", inputEncoding: "bytes", outputEncoding: "bytes"
    });
    if (!decoded || !decoded.success || !decoded.data) throw new Error("Yandex Music audio decryption failed: " + String(decoded && decoded.error || "unknown error"));
    var written = file.writeBytes(destinationPath, new Uint8Array(decoded.data), {offset: offset, encoding: "bytes", truncate: offset === 0});
    if (!written || !written.success) throw new Error("Could not write decrypted Yandex Music audio.");
    if (typeof onProgress === "function") onProgress(Math.min(99, 70 + Math.round((offset + length) / size * 29)));
  }
}
/** Downloads a track and cleans up encrypted or partial outputs. */
async function download(trackId, quality, destinationPath, onProgress) {
  if (!trackId) throw new Error("Missing Yandex Music track ID.");
  var info = getDownloadInfo(trackId, quality), format = outputFormat(info.codec);
  var target = String(destinationPath).replace(/\.flac$/i, format.extension), encrypted = target + ".encrypted";
  var key = String(info.key || info.decryption_key || "").trim();
  if (onProgress) onProgress(5);
  var downloaded = false, lastError = "", urls = info.urls.slice(0, 5);
  for (var i = 0; i < urls.length; i++) {
    var result = file.download(String(urls[i]), key ? encrypted : target, {
      maxAttempts: 3, resume: false,
      onProgress: function (written, total) { if (typeof onProgress === "function" && Number(total) > 0) onProgress(Math.min(65, 5 + Math.round(Number(written) / Number(total) * 60))); }
    });
    if (result && result.success) { downloaded = true; break; }
    lastError = String(result && result.error || "audio host refused the download");
    try { file.delete(key ? encrypted : target); } catch (_) {}
  }
  if (!downloaded) throw new Error("Yandex Music audio download failed: " + lastError);
  if (key) {
    try { decryptFile(encrypted, target, key, onProgress); }
    catch (error) { try { file.delete(target); } catch (_) {} throw error; }
    finally { try { file.delete(encrypted); } catch (_) {} }
  }
  if (onProgress) onProgress(100);
  var finalInfo = file.getSize(target);
  if (!finalInfo || !finalInfo.success || !finalInfo.size) { try { file.delete(target); } catch (_) {}; throw new Error("Yandex Music produced an empty audio file."); }
  return {success: true, file_path: target, output_extension: format.extension, requires_container_conversion: format.requiresConversion};
}
registerExtension({initialize: initialize, searchTracks: searchTracks, customSearch: customSearch, getTrack: getTrack, getAlbum: getAlbum, getArtist: getArtist, handleUrl: handleUrl, download: download});
