import type { LucideIcon } from 'lucide-react'
import { Coffee, Maximize, Minimize } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  KEEP_AWAKE_MODES,
  type KeepAwakeMode,
  type KeepAwakeState,
  keepAwakeSummary,
} from '../../../shared/app/keep-awake'
import { machineWordsHere } from '../chrome'
import { cx, useDismiss } from '../ui'
import '../ui/tailwind.css'

export interface MapControlsProps {
  fullscreen: boolean
  onFullscreen(): void
  /** The cup's state. Off macOS it is unsupported and the cup does not appear (T99). */
  keepAwake: KeepAwakeState
  onKeepAwake(mode: KeepAwakeMode): void
}

/**
 * The coffee cup and full screen, and nothing else: the office is not zoomable, so the room
 * always stands at the size the window gives it (design/html/office.html layer `Map Controls`,
 * with the cup from `design/screens/sMIWE.png`).
 */
export function MapControls(props: MapControlsProps) {
  return (
    <fieldset className={CONTROLS} aria-label="Office">
      {props.keepAwake.supported && <KeepAwakeCup state={props.keepAwake} onPick={props.onKeepAwake} />}
      <MapButton
        icon={props.fullscreen ? Minimize : Maximize}
        label={props.fullscreen ? 'Exit full screen' : 'Full screen'}
        onClick={props.onFullscreen}
      />
    </fieldset>
  )
}

/**
 * The cup: lit while the Mac is held awake and grey while it is not, so the state reads without
 * opening anything, and a menu of the three modes behind it.
 */
function KeepAwakeCup(props: { state: KeepAwakeState; onPick(mode: KeepAwakeMode): void }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const dismiss = useDismiss<HTMLDivElement, HTMLElement>(open, close)

  const summary = keepAwakeSummary(props.state)
  const title = `Keep ${machineWordsHere().machine} awake`
  return (
    <div className="relative flex" ref={dismiss.popover}>
      <button
        type="button"
        className={cx(MAP_BUTTON, CUP)}
        data-holding={props.state.holding || undefined}
        aria-label={`${title} — ${summary}`}
        title={`${title} — ${summary}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Coffee size={16} aria-hidden />
      </button>
      {open && (
        <div className={MENU} role="menu" aria-label={title}>
          <div className="flex items-center justify-between gap-12 border-b border-b-border px-16 py-14">
            <span className="font-bold text-14/normal text-popover-foreground">{title}</span>
            <span className={STATE} data-holding={props.state.holding || undefined}>
              {summary}
            </span>
          </div>
          {KEEP_AWAKE_MODES.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              role="menuitemradio"
              aria-checked={entry.mode === props.state.mode}
              className={MODE}
              data-chosen={entry.mode === props.state.mode || undefined}
              onClick={() => {
                props.onPick(entry.mode)
                close()
              }}
            >
              <span className={DOT} aria-hidden />
              <span className="flex flex-col gap-2">
                <span className={MODE_TITLE}>{entry.title}</span>
                <span className="text-12/[1.4] text-muted-foreground">{entry.body}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MapButton(props: { icon: LucideIcon; label: string; onClick(): void }) {
  const Icon = props.icon
  return (
    <button type="button" className={MAP_BUTTON} aria-label={props.label} title={props.label} onClick={props.onClick}>
      <Icon size={16} aria-hidden />
    </button>
  )
}

/*
 * Map Controls (layer `Map Controls`), as utilities (T210f). The office's own float colours —
 * `#0f172ae6` the fill, `#ffffff24` the stroke, `#ffffff1f` the lit cup's tile — have no token.
 * Out of budget the whole control dims to 45%, from the canvas's own attribute.
 */
const CONTROLS =
  'absolute right-34 bottom-26 z-2 flex items-center gap-2 rounded-full border border-[#ffffff24] bg-[#0f172ae6] p-4 [[data-out-of-budget]_&]:opacity-45'

const MAP_BUTTON =
  'm-0 flex h-32 w-32 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[#cbd5e1] hover:bg-secondary focus-visible:shadow-focus focus-visible:outline-none'

/** Lit while the Mac is held awake, so the state reads without opening anything. */
const CUP = 'data-holding:bg-[#ffffff1f] data-holding:text-brand-success'

const MENU =
  'absolute right-0 bottom-[calc(100%+10px)] flex w-360 flex-col overflow-hidden rounded-md border border-border bg-popover shadow-[0px_8px_24px_0px_#00000059]'

const STATE = 'whitespace-nowrap text-12/normal text-muted-foreground data-holding:text-brand-success'

/** The three modes. The frame washes the chosen one, and hovering washes a little harder. */
const MODE =
  'm-0 flex cursor-pointer items-start gap-12 border-0 bg-transparent px-16 py-12 text-left hover:bg-[#ffffff14] data-chosen:bg-[#ffffff0a]'

/*
 * The radio mark: hollow until the mode is the one on, then the same green as the cup. One 8px dot
 * for all three, as the frame draws them, 20px in from the menu's outer edge — the frame's row
 * starts under the menu's inside stroke, ours after its 1px border, so 3px here is its 4px.
 *
 * Only the ink changes when it is chosen. A size or a margin here would give the column two dots.
 */
const DOT =
  'mt-5 mr-4 mb-0 ml-3 h-8 w-8 shrink-0 rounded-full border border-[#ffffff3d] in-data-chosen:border-transparent in-data-chosen:bg-brand-success'

const MODE_TITLE = 'font-medium text-14/normal text-popover-foreground in-data-chosen:font-bold'
