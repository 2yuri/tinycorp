import { Building2, Maximize2, PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import '../ui/tailwind.css'
import { cx, SHELL_BUTTON } from '../ui'

/**
 * The 44px draggable title bar drawn around the native traffic lights. `plain` is the Company
 * Launcher's variant: the title alone, without the icon and the window actions. `notice` is the
 * quiet line beside the title — today only "a newer build exists" (T130) — and draws nothing
 * when there is nothing to say.
 */
export function TitleBar(props: {
  title: string
  notice?: ReactNode
  onToggleSidebar?: (() => void) | undefined
  onToggleMaximize(): void
  plain?: boolean | undefined
}) {
  return (
    // Double-click to maximize is the window's own gesture, not a control: the Maximize button
    // beside the title is how a keyboard does the same thing.
    // biome-ignore lint/a11y/noStaticElementInteractions: the keyboard path is the button below.
    <header className={BAR} data-ui="Title Bar" onDoubleClick={props.onToggleMaximize}>
      {/* The native traffic lights sit here (`trafficLightPosition` in the main process). Off macOS
          the window's own buttons are an overlay on the right of the bar instead (T166), so this
          slot is nothing at all and the right column keeps them clear. */}
      <div data-ui="Traffic Lights" className={LIGHTS} aria-hidden />
      {/* The plain bar drops the Company icon; the notice beside the title stays. */}
      <div data-ui="Window Title" className={props.plain ? cx(TITLE, '[&>svg]:hidden') : TITLE}>
        <Building2 size={14} aria-hidden />
        <span className="overflow-hidden text-ellipsis">{props.title}</span>
        {props.notice}
      </div>
      {/* Nothing here is draggable-to-maximize: this handler stops the gesture, it never starts one. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: it cancels an interaction rather than adding one. */}
      <div
        className={props.plain ? cx(ACTIONS, '[&>*]:hidden') : ACTIONS}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={cx(SHELL_BUTTON, ACTION)}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          disabled={!props.onToggleSidebar}
          onClick={props.onToggleSidebar}
        >
          <PanelLeft size={16} aria-hidden />
        </button>
        <button
          type="button"
          className={cx(SHELL_BUTTON, ACTION)}
          aria-label="Maximize"
          title="Maximize"
          onClick={props.onToggleMaximize}
        >
          <Maximize2 size={16} aria-hidden />
        </button>
      </div>
    </header>
  )
}

/**
 * The bar itself (T210f): three columns, the two outer ones equal, so the title sits on the
 * window's centre whatever stands on either side of it. On Windows and Linux the left slot is
 * empty and the right one also holds the window's own buttons, an overlay 138px wide
 * (`WINDOW_CONTROLS_WIDTH`, T166); a flex row centred the title between the two and put it a
 * hundred and thirty pixels left of the middle on the first Windows run. The overlay's width is
 * kept clear as the actions' right margin plus the bar's own 16px, so the buttons still end where
 * the overlay begins. When the window is too narrow for both, the right column keeps its width
 * and the title gives way, rather than running under the buttons.
 */
const BAR =
  'grid h-44 w-full shrink-0 select-none grid-cols-[1fr_auto_1fr] items-center gap-12 border-b border-b-border bg-card px-16 [-webkit-app-region:drag]'

const LIGHTS = 'col-start-1 h-12 w-120 shrink-0 in-[[data-platform=win32]]:hidden in-[[data-platform=linux]]:hidden'

const TITLE =
  'col-start-2 flex min-w-0 items-center justify-center gap-8 whitespace-nowrap font-semibold text-13/normal text-muted-foreground [&>svg]:shrink-0'

const ACTIONS =
  'col-start-3 flex w-120 shrink-0 items-center justify-end justify-self-end gap-14 in-[[data-platform=win32]]:mr-122 in-[[data-platform=linux]]:mr-122'

const ACTION = 'flex p-0 text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]'
