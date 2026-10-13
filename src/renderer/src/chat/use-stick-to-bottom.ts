import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

/** How close to the end, in pixels, still counts as reading the end: a line or two of slack. */
export const NEAR_BOTTOM = 160

/** True when `el` is scrolled to within `NEAR_BOTTOM` of its end. */
export function isNearBottom(el: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM
}

/**
 * Keeps a conversation at its newest message (T287). A new last message scrolls the list to its
 * end — keyed on the last id, not the count, because a capped page that gains one message loses
 * one and the count never moves. While the reader is at the end, anything that grows after it was
 * drawn — an image arriving, a card filling in — keeps it there too; once they scroll up to read
 * history, the list stays where they put it. `hold` is a jump in progress (a pin, a search result,
 * a notification), which owns the scroll until it is let go.
 */
export function useStickToBottom(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  lastId: number | null,
  hold: boolean,
): void {
  const atBottom = useRef(true)
  const held = useRef(hold)
  held.current = hold

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      atBottom.current = isNearBottom(el)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scroller])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new last message is the trigger; the effect reads the refs.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || held.current || lastId === null) return
    el.scrollTop = el.scrollHeight
    atBottom.current = true
  }, [lastId])

  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (atBottom.current && !held.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [scroller, content])
}
