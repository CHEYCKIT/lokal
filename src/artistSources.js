// Where artist bios and pictures can come from (Settings > Artist Info
// Source, Artist > Manage > Lookup, Artists > Refresh artist info).
// Auto picks the photo and the bio separately, each from the best provider
// that has one, never Wikipedia (see AUTO_IMAGE_ORDER / AUTO_BIO_ORDER in
// artistMetadata.js).
export const ARTIST_SOURCES = [
  ['either', 'Auto'],
  ['theaudiodb', 'TheAudioDB'],
  ['deezer', 'Deezer'],
  ['musicbrainz', 'MusicBrainz'],
  ['wikipedia', 'Wikipedia'],
]
