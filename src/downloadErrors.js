// A failed download's error, in plain words. Addons tend to answer with one
// long technical line ("No TIDAL download source returned a usable payload |
// HI_RES_LOSSLESS API attempt 1: HTTP 429; …"): the row says what it means,
// and the whole message stays one hover / click away.

// Short enough for the Downloads panel's row; the ⓘ shows the rest.
const CAUSES = [
  { test: /\b429\b|rate.?limit|too many requests|limiting requests/i, say: who => `${who} is limiting requests for now.` },
  { test: /verif(y|ication).?required|VERIFY_REQUIRED/i, say: () => 'The addon needs verifying again.' },
  { test: /\b40[13]\b|unauthori[sz]ed|forbidden|SESSION_INVALID|did not accept/i, say: who => `${who} refused the request.` },
  { test: /\b50[0234]\b|PROVIDER_UNAVAILABLE|service unavailable|bad gateway|temporarily unavailable/i, say: who => `${who} is unavailable right now.` },
  { test: /timed? ?out|RESOLUTION_TIMEOUT|didn't answer/i, say: who => `${who} didn't answer in time.` },
  { test: /\b404\b|not found|no (close )?match|not available|unavailable in your (region|country)/i, say: who => (who === 'The source' ? 'Not available from this source.' : `Not available on ${who}.`) },
]

/**
 * { summary, detail }: what the row shows, and the full message when it
 * says more than that (null otherwise).
 */
export function explainDownloadError(message) {
  const full = String(message || '').trim()
  if (!full) return { summary: 'Failed', detail: null }
  const [headline, ...rest] = full.split(/\s+\|\s+/)
  const named = headline.match(/^No (.+?) download source\b/i)
  const who = named ? named[1] : 'The source'
  // The cause is in the details when there are any (the headline is generic).
  const cause = CAUSES.find(({ test }) => test.test(rest.length ? rest.join(' ') : full))
  const summary = cause ? cause.say(who) : headline
  return { summary, detail: summary === full ? null : full }
}
