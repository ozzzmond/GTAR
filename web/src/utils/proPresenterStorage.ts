import type { FollowSnapshot } from '../extensions/host/ExtensionHost'

export type ProPresenterStatusLevel = 'green' | 'yellow' | 'red' | 'disabled'

export interface ProPresenterStatusInfo {
  level: ProPresenterStatusLevel
  label: string
  detail: string
}

export function getProPresenterStatus({
  enabled,
  hostState,
  liveSnapshot,
  autoFollowState,
  liveConfirmed,
  liveScrollPaused,
}: {
  enabled: boolean
  hostState: string
  liveSnapshot: FollowSnapshot | null
  autoFollowState?: { mode: 'assisted' | 'auto'; paused: boolean; choices: readonly unknown[]; status: string }
  liveConfirmed?: boolean
  liveScrollPaused?: boolean
}): ProPresenterStatusInfo {
  if (!enabled || hostState === 'disabled' || hostState === 'absent' || hostState === 'unavailable') {
    return { level: 'disabled', label: 'ProPresenter disabled', detail: 'ProPresenter follower is disabled' }
  }

  // Red: disconnected or connection error while enabled
  if (hostState === 'error' || hostState === 'offline' || !liveSnapshot?.live) {
    return {
      level: 'red',
      label: hostState === 'error' ? 'ProPresenter: Connection error' : 'ProPresenter: Disconnected',
      detail: hostState === 'error' ? 'Connection error while communicating with ProPresenter' : 'Disconnected or ProPresenter unreachable',
    }
  }

  // Connected (hostState active, liveSnapshot live)
  // Auto Follow mode
  if (autoFollowState?.mode === 'auto') {
    if (autoFollowState.paused) {
      return {
        level: 'yellow',
        label: 'ProPresenter: Auto Follow paused',
        detail: 'Paused due to manual scroll or song override. Awaiting resumption.',
      }
    }
    if (autoFollowState.choices && autoFollowState.choices.length > 0) {
      return {
        level: 'yellow',
        label: 'ProPresenter: Ambiguous match',
        detail: 'Multiple matching songs found in current setlist. Choose an entry.',
      }
    }
    return {
      level: 'green',
      label: 'ProPresenter: Actively following',
      detail: 'Auto Follow active for current setlist',
    }
  }

  // Assisted mode
  if (liveConfirmed) {
    if (liveScrollPaused) {
      return {
        level: 'yellow',
        label: 'ProPresenter: Scrolling paused',
        detail: 'Manual scrolling pauses auto-scroll. Highlights remain active.',
      }
    }
    return {
      level: 'green',
      label: 'ProPresenter: Live lyrics active',
      detail: 'Connected and actively following current slide lyrics',
    }
  }

  // Connected, but awaiting confirmation in assisted mode
  return {
    level: 'yellow',
    label: 'ProPresenter: Awaiting confirmation',
    detail: 'Connected to ProPresenter. Confirm song to start Live Lyrics.',
  }
}
