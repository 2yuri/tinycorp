import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { ClipboardPaste, Copy, Eraser } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { rightClickAction, rightClickSetting } from '../../../shared/platform/terminal-right-click'
import { hostPlatform } from '../chrome'
import { resources, useIpcResource } from '../ipc'
import { DropdownMenu, MenuItem, useDismiss } from '../ui'
import '@xterm/xterm/css/xterm.css'
import '../ui/tailwind.css'

const api = window.tinyCorp.terminals

/**
 * The box xterm draws into, and the two rules that reach inside it.
 *
 * `!` is here for the one reason `docs/engineering.md` allows it: `@xterm/xterm/css/xterm.css` is a
 * vendor sheet imported **unlayered**, and an unlayered declaration beats every layer — so
 * `.xterm .xterm-viewport { background-color: #000 }` would win over `@layer utilities` however
 * specific the utility. This is not the kit being out-layered; nothing in this repo can layer a
 * file it does not own. `live-terminal.css` needed the same `!` before T208 and for the same reason.
 *
 * xterm paints the cells from the `theme` above and the viewport from CSS, so both have to name the
 * same ground or the box shows through black while it scrolls.
 *
 * The box takes the panel's height with `flex-1` rather than its content's: the fit measures this
 * box, so a box as tall as xterm's own rows measures the 24 rows it started with forever, however
 * tall the drawer is. The rest of the panel then sits empty and the Session is told 24 rows — and
 * an agent whose PTY was spawned taller pushes its input box and status line past the last row,
 * where they arrive as the stray numbers TI-3 reported.
 */
const SCREEN =
  'min-h-0 flex-1 [&_.xterm]:h-full [&_.xterm]:bg-terminal! [&_.xterm-viewport]:h-full [&_.xterm-viewport]:bg-terminal!'

const RESIZE_DEBOUNCE_MS = 60
/** The designed terminal box (Employee Drawer / Terminal): 12px JetBrains Mono on the terminal ink. */
const FONT_FAMILY = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'
const FONT_SIZE = 12

export interface LiveTerminalProps {
  employeeId: string
  /** Whether the terminal is shown; it takes the keyboard when it becomes so. */
  active: boolean
  onError(error: string | null): void
  /** Drawn above the screen, inside the terminal's wrap: the drawer's subagent strip (T162). */
  header?: ReactNode
}

/** An Employee's live terminal. Kept attached while hidden, so switching tabs loses nothing. */
export function LiveTerminal({ employeeId, active, onError, header }: LiveTerminalProps) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  /**
   * What the right button does here (T249): the boss's answer, or this platform's habit until they
   * have one. It is read into a ref because the listener is attached once, with the terminal, and
   * a boss who changes the setting in Your profile should not cost the Session a teardown.
   */
  const setting = rightClickSetting(useIpcResource(resources.bossProfile)?.rightClick ?? null, hostPlatform())
  const settingRef = useRef(setting)
  settingRef.current = setting
  // Where the menu was asked for, in viewport coordinates, or null while it is closed.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const dismiss = useDismiss<HTMLDivElement, HTMLElement>(menu !== null, closeMenu)

  useEffect(() => {
    const element = host.current!
    const style = getComputedStyle(element)
    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: {
        background: style.getPropertyValue('--terminal').trim(),
        foreground: style.getPropertyValue('--terminal-foreground').trim(),
        cursor: style.getPropertyValue('--terminal-foreground').trim(),
      },
    })
    terminal.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(element)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // No WebGL: xterm falls back to its DOM renderer.
    }

    let disposed = false
    const report = (result: { ok: boolean; error?: string }) => {
      if (!disposed) onError(result.ok ? null : (result.error ?? null))
    }

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const sendSize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        void api.resize(employeeId, term.cols, term.rows).then(report)
      }, RESIZE_DEBOUNCE_MS)
    }
    const sized = term.onResize(sendSize)

    /**
     * Measure the box, then tell the Session what it holds — and do neither while the box has no
     * layout, which is what a drawer open on another tab is. Unmeasured, xterm still reports the
     * 80×24 it was constructed with, and sending that would squash a live Session to a size
     * nothing is showing — the same cut-off TI-3 is about, from the other end. The observer brings
     * the box back the moment it has a size.
     *
     * The size goes out even when the fit changed nothing, because a resize is also how the agent
     * is asked to repaint: a Session that started before this terminal opened drew its frame at
     * its Provider's own size, and that frame is what the replay just wrote.
     */
    const refit = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      fit.fit()
      sendSize()
    }
    const observer = new ResizeObserver(refit)
    observer.observe(element)
    refit()

    // Output that arrives before the replay is written waits behind it.
    let pending: string[] | null = []
    const stopData = api.onData((id, data) => {
      if (id !== employeeId) return
      if (pending) pending.push(data)
      else term.write(data)
    })
    void api.attach(employeeId).then((result) => {
      if (disposed) return
      report(result)
      if (result.ok) term.write(result.value)
      for (const data of pending ?? []) term.write(data)
      pending = null
      refit()
    })

    const input = term.onData((data) => void api.write(employeeId, data).then(report))
    const binary = term.onBinary((data) => void api.write(employeeId, data).then(report))

    /**
     * The right button (T249). The paste goes through xterm's own `paste` rather than straight to
     * the PTY, because xterm is what knows whether the program on the other end asked for bracketed
     * paste — without it a multi-line paste arrives at an agent's input box as a run of Enters.
     *
     * The clipboard is read in the main process: this window refuses every permission it is asked
     * (`window-policy.ts`), so `navigator.clipboard.readText()` is denied in a packaged build.
     */
    const onContextMenu = (event: MouseEvent) => {
      // There is no menu underneath to fall through to: Electron draws none, so whichever answer
      // this is, it is ours to draw.
      event.preventDefault()
      const other = hostPlatform() === 'darwin' ? event.metaKey : event.ctrlKey
      if (rightClickAction(settingRef.current, other) === 'menu') {
        setMenu({ x: event.clientX, y: event.clientY })
        return
      }
      setMenu(null)
      void api.clipboard().then((result) => {
        if (disposed) return
        if (!result.ok) return report(result)
        if (result.value) term.paste(result.value)
      })
    }
    element.addEventListener('contextmenu', onContextMenu)

    // The cell size was measured with a fallback if the web font was not loaded yet.
    void document.fonts.load(`${FONT_SIZE}px ${FONT_FAMILY}`).then(() => {
      if (disposed) return
      term.options.fontFamily = FONT_FAMILY
      refit()
    })

    return () => {
      disposed = true
      terminal.current = null
      clearTimeout(resizeTimer)
      observer.disconnect()
      element.removeEventListener('contextmenu', onContextMenu)
      input.dispose()
      binary.dispose()
      sized.dispose()
      stopData()
      void api.detach(employeeId)
      term.dispose()
    }
  }, [employeeId, onError])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different Employee takes the focus back into its own terminal.
  useEffect(() => {
    if (active) terminal.current?.focus()
  }, [active, employeeId])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-8 px-14 pt-12 pb-10 [&[hidden]]:hidden"
      hidden={!active}
      data-testid="live-terminal"
    >
      {header}
      <div className={SCREEN} ref={host} />
      {menu && (
        <div
          ref={dismiss.popover}
          data-testid="terminal-menu"
          className="fixed z-30"
          /* A menu that opens where the pointer is cannot be a class: the two numbers are the
             event's own. Everything else about it is the kit's. */
          style={{ left: menu.x, top: menu.y }}
        >
          <DropdownMenu>
            <MenuItem icon={Copy} label="Copy" onClick={() => act(() => copySelection(terminal.current))} />
            <MenuItem icon={ClipboardPaste} label="Paste" onClick={() => act(() => pasteClipboard(terminal.current))} />
            <MenuItem icon={Eraser} label="Clear" onClick={() => act(() => terminal.current?.clear())} />
          </DropdownMenu>
        </div>
      )}
    </div>
  )

  /** Every row closes the menu and then does its own thing. */
  function act(run: () => void) {
    setMenu(null)
    run()
  }
}

/** What is selected, on the clipboard. Writing one is allowed where reading one is not. */
function copySelection(term: Terminal | null): void {
  const selected = term?.getSelection() ?? ''
  if (selected) void navigator.clipboard?.writeText(selected)
}

function pasteClipboard(term: Terminal | null): void {
  if (!term) return
  void api.clipboard().then((result) => {
    if (result.ok && result.value) term.paste(result.value)
  })
}
