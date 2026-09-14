/**
 * Environment detection helper.
 * Determines if the application is running in a DEV or Preview environment
 * vs Production.
 */
export const isDevEnv: boolean =
  Boolean(import.meta.env.DEV) ||
  import.meta.env.VITE_APP_ENV === 'debug' ||
  (typeof window !== 'undefined' &&
    (window.location.hostname.includes('dev.gtar-web.pages.dev') ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'))
