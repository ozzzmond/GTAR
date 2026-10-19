/** Recognizes presentation entry points without rewriting their query or session data. */
export function isPresentationLocation(location: { pathname?: string; search?: string; hash?: string }): boolean {
  return location.pathname === '/tv' || location.pathname === '/tv/' ||
    Boolean(location.pathname?.includes('/stage/present') ||
      location.search?.includes('view=present') || location.hash?.includes('present'))
}
