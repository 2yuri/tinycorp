import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { cx } from '../ui'
import '@xterm/xterm/css/xterm.css'
import '../ui/tailwind.css'

/**
 * A terminal onto one PTY that is not an Employee's: the sign-in modal's (T263).
 *
 * It is smaller than {@link LiveTerminal} on purpose — no replay, no right-click menu, no WebGL —
 * because it lives for one sign-in and shows a CLI's own few screens. The box's own background is
 * the terminal's ground, so the frame's colour is the one xterm paints with.
 *
 * `!` for the reason `LiveTerminal` gives: xterm's sheet is unlayered and paints the viewport black.
 */
const SCREEN =
  'min-h-0 flex-1 [&_.xterm]:h-full [&_.xterm]:bg-transparent! [&_.xterm-viewport]:h-full [&_.xterm-viewport]:bg-transparent!'

const FONT_FAMILY = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'
const FONT_SIZE = 12

export interface PtyScreenProps {
  /** What the PTY has printed so far and everything it prints next. Returns an unsubscribe. */
  subscribe(write: (data: string) => void): () => void
  onInput(data: string): void
  onResize(cols: number, rows: number): void
  className?: string
}

export function PtyScreen({ subscribe, onInput, onResize, className }: PtyScreenProps) {
  const host = useRef<HTMLDivElement>(null)
  const handlers = useRef({ onInput, onResize })
  handlers.current = { onInput, onResize }

  useEffect(() => {
    const element = host.current!
    const style = getComputedStyle(element)
    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      cursorBlink: true,
      scrollback: 1000,
      theme: {
        background: style.backgroundColor,
        foreground: style.color,
        cursor: style.color,
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(element)
    const refit = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      fit.fit()
      handlers.current.onResize(term.cols, term.rows)
    }
    const observer = new ResizeObserver(refit)
    observer.observe(element)
    refit()
    const stop = subscribe((data) => term.write(data))
    const input = term.onData((data) => handlers.current.onInput(data))
    term.focus()
    return () => {
      observer.disconnect()
      stop()
      input.dispose()
      term.dispose()
    }
  }, [subscribe])

  return <div ref={host} data-testid="pty-screen" className={cx(SCREEN, className)} />
}
