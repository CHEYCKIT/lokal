// The Discord app Lokal's Rich Presence uses unless Settings names another one.
export const DEFAULT_DISCORD_CLIENT_ID = '1473597925581131919'

/** The Discord app id from settings: the default one, or the custom one. */
export function discordClientId(settings = {}) {
  return settings.discord_use_default_app_id === '0' ? String(settings.discord_client_id || '').trim() : DEFAULT_DISCORD_CLIENT_ID
}
