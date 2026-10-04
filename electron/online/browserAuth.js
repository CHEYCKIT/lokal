/** Decode internal browser-session context and legacy cookie strings as data. */
function browserHeaders(value) {
  const text = String(value || '').trim()
  const headers = {}
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      for (const [key, value] of Object.entries(parsed.headers || parsed)) if (typeof value === 'string') headers[key.toLowerCase()] = value
    } catch { return {} }
  } else {
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([\w-]+):\s*(.*)$/)
      if (match) headers[match[1].toLowerCase()] = match[2]
    }
    if (!Object.keys(headers).length && !text.includes('\t')) headers.cookie = text
  }
  return headers
}

function normalizeCookies(value) {
  const text = String(value || '').trim()
  if (text.includes('\t') && !text.startsWith('{')) return text.split(/\r?\n/).map(line => line.split('\t')).filter(fields => fields.length >= 7 && /(?:^|\.)youtube\.com$/i.test(fields[0].replace(/^#HttpOnly_/, ''))).map(fields => `${fields[5]}=${fields[6]}`).join('; ')
  return String(browserHeaders(text).cookie || '').replace(/[\r\n]+/g, ' ').trim()
}

function browserContext(value) {
  const headers = browserHeaders(value)
  return {
    ...(headers['x-goog-authuser'] ? { SESSION_INDEX: headers['x-goog-authuser'] } : {}),
    ...(headers['x-goog-pageid'] ? { DELEGATED_SESSION_ID: headers['x-goog-pageid'] } : {}),
    ...(headers['x-goog-visitor-id'] ? { VISITOR_DATA: headers['x-goog-visitor-id'] } : {}),
    ...(headers['x-youtube-client-version'] ? { INNERTUBE_CLIENT_VERSION: headers['x-youtube-client-version'] } : {}),
    ...(headers['user-agent'] ? { USER_AGENT: headers['user-agent'] } : {}),
  }
}

module.exports = { browserHeaders, normalizeCookies, browserContext }
