declare const __GTAR_STAGE_CAST2_ENABLED__: boolean | undefined

/**
 * Stage Cast 2.0 Feature Gate:
 * Strictly disabled in PROD builds.
 * Available in authorized DEV builds and local review environments.
 * Server authorization (GTAR session + explicit TV receiver approval) is always enforced.
 */
export const stageCast2Enabled = typeof __GTAR_STAGE_CAST2_ENABLED__ !== 'undefined'
  ? Boolean(__GTAR_STAGE_CAST2_ENABLED__)
  : (Boolean(import.meta.env.DEV) && import.meta.env.VITE_CAST2_LOCAL_REVIEW === 'true')

export const cast2LocalEnabled = stageCast2Enabled
export const cast2ReceiverRoute = stageCast2Enabled && typeof window !== 'undefined' && (window.location.pathname === '/tv/cast2' || window.location.pathname === '/tv' || window.location.pathname === '/tv/')
