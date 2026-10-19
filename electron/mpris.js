// Electron's Chromium build already implements the Linux MPRIS D-Bus
// service from navigator.mediaSession (enabled through MediaSessionService in
// main.js). Give that native service Lokal's stable desktop identity instead
// of the default Chromium name; no separate D-Bus daemon or JS D-Bus client is
// needed.
function configureMprisIdentity(app, platform = process.platform) {
  if (platform !== 'linux') return false
  app.commandLine.appendSwitch('mpris-name', 'lokal')
  return true
}

module.exports = { configureMprisIdentity }
