declare const __GTAR_CHROMECAST_APP_ID__: string | undefined

/** Public configuration. Never fall back to Google's sample or media receiver. */
export function chromecastAppId(value: unknown, cast2Enabled: boolean): string {
  const id = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return cast2Enabled && /^[A-F0-9]{8}$/.test(id) && !['EF1A139F', 'CC1AD845', '00000000'].includes(id) ? id : ''
}

export const configuredChromecastAppId = typeof __GTAR_CHROMECAST_APP_ID__ === 'string' ? __GTAR_CHROMECAST_APP_ID__ : ''

export function supportsChromecastSender(environment: {
  secure: boolean; android: boolean; presentation: boolean; userAgent: string; vendor: string
}): boolean {
  return environment.secure && environment.android && environment.presentation &&
    /Chrome\/\d+/.test(environment.userAgent) && environment.vendor === 'Google Inc.' &&
    !/EdgA|OPR|SamsungBrowser|; wv\)/i.test(environment.userAgent)
}
