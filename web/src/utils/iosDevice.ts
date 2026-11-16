/**
 * iPhone, iPad or iPod, including an iPad that reports itself as a Mac. Shared by the features
 * that are N/A on iOS (ProPresenter, MIDI).
 */
export function isIosDevice(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = globalThis.navigator): boolean {
  const ua = nav?.userAgent ?? ''
  return /iPad|iPhone|iPod/i.test(ua) || (/Macintosh|MacIntel/i.test(`${ua} ${nav?.platform}`) && (nav?.maxTouchPoints ?? 0) > 1)
}
