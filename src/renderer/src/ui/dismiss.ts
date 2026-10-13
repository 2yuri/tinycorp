import { type RefObject, useEffect, useRef } from 'react'

/**
 * The two ways every desktop menu closes: a pointer down outside it, and Escape (T223).
 *
 * Put `popover` on the box and `trigger` on the button that opens it, and leave `trigger` off where
 * the two already share one wrapper — a pointer down inside either is not outside. The trigger has
 * a ref of its own because an Employee card positions the two from different places in its tree,
 * and a pointer down on the button that would be read as outside closes the menu under its own
 * `onClick`, which then opens it again.
 *
 * The listeners are on `document` and only while `open`, so nothing is subscribed for the menus
 * that are shut — which is every one of them, nearly all of the time.
 */
export function useDismiss<P extends HTMLElement, T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): { popover: RefObject<P | null>; trigger: RefObject<T | null> } {
  const popover = useRef<P>(null)
  const trigger = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const held = (node: Node) => popover.current?.contains(node) === true || trigger.current?.contains(node) === true
    const onPointer = (event: PointerEvent) => {
      if (!held(event.target as Node)) onDismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onDismiss])
  return { popover, trigger }
}
