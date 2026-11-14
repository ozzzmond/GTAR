import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { LiveLyricScroller, type LiveScrollInput } from './liveLyricScroll'

export function useLiveLyricScroll(container: RefObject<HTMLDivElement | null>, input: LiveScrollInput) {
  const [controller] = useState(() => new LiveLyricScroller())
  const paused = useSyncExternalStore(controller.subscribe, controller.getPaused, controller.getPaused)
  useLayoutEffect(() => {
    if (container.current) return controller.attach(container.current)
  }, [controller, container])
  // Update after every commit so confirmation loss cancels before the next animation frame.
  useLayoutEffect(() => { controller.update(input) })
  return { controller, paused }
}
