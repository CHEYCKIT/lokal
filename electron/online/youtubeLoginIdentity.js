/** Chromium reads this switch at startup, before any sign-in renderer exists. */
function configureLoginIdentity(app) {
  const features = new Set(app.commandLine.getSwitchValue('disable-blink-features').split(',').map(value => value.trim()).filter(Boolean))
  features.add('AutomationControlled')
  app.commandLine.appendSwitch('disable-blink-features', [...features].join(','))
}

function browserUserAgent(value) {
  return String(value || '').replace(/\s+(?:Electron|lokal(?:-music)?)\/[\w.+-]+/gi, '').trim()
}

module.exports = { configureLoginIdentity, browserUserAgent }
