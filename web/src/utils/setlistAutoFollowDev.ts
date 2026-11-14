declare const __GTAR_SETLIST_AUTO_FOLLOW_DEV__: boolean
// Explicit feature gate: DEV/local/branch previews only, never a production build.
export const setlistAutoFollowDev = typeof __GTAR_SETLIST_AUTO_FOLLOW_DEV__ === 'boolean' && __GTAR_SETLIST_AUTO_FOLLOW_DEV__
