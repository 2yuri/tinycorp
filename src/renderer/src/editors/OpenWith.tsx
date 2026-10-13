import { Check, ChevronDown, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { type EditorsState, editorLabel, editorOptions } from '../../../shared/files/editors'
import { hostPlatform } from '../chrome'
import { Button } from '../ui'
import '../ui/tailwind.css'

/** The header the list carries, as the design writes it (design/screens/CwBoJ.png). */
export const OPEN_WITH = 'Open with'

/** The line under the list: why the button says a name at all. */
export const OPEN_WITH_NOTE = 'The button says the one you picked, so you know before you click.'

export interface OpenWithProps {
  /** What this machine has, what the boss picked, and what is in force. */
  editors: EditorsState
  /** The file the button would hand over, which is what the system default row describes. */
  path?: string | null | undefined
  disabled?: boolean | undefined
  /** Whether the list is showing; the view above owns it, so only one is ever open. */
  open: boolean
  onToggle(open: boolean): void
  /** The button itself: hand the file to the editor it names. */
  onOpen(): void
  /** A row of the list: an editor id, or `system`. */
  onChoose(id: string): void
}

/**
 * `Open in <editor>` and the list behind its chevron (T123, `design/screens/CwBoJ.png`).
 *
 * The button and the chevron read as one control, so the pair carries the ground and the radius and
 * the two halves square the edge they meet on — which is why the kit Button takes
 * `rounded-r-none pr-8` here. A utility out-layers the kit since T208, so none of it needs `!`.
 *
 * The hover ground keeps `color-mix(… in srgb …)` as a raw value rather than becoming
 * `bg-secondary/70`: Tailwind's opacity modifier mixes in `oklab`, and over a dark ground the two
 * spaces do not land on the same pixel. `hover:` also compiles inside `@media (hover: hover)`,
 * which the old selector had no equivalent of — moot on a desktop app with a pointer, and noted
 * rather than worked around.
 *
 * `open-with__chevron` stays in the list because `files/capture/FilesCapture.tsx` clicks it to open
 * the list for a screenshot.
 */
const PAIR =
  'inline-flex items-stretch rounded-md bg-secondary data-disabled:opacity-50 hover:not-data-disabled:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)]'

const CHEVRON =
  'open-with__chevron inline-flex cursor-pointer items-center rounded-r-md border-0 bg-transparent py-0 pr-10 pl-2 text-secondary-foreground disabled:cursor-default'

const MENU =
  'absolute top-[calc(100%+var(--space-2))] right-0 z-30 flex min-w-320 flex-col rounded-sm border border-border bg-popover pb-8 shadow-menu'

const HEAD = 'm-0 px-14 pt-9 font-sans font-semibold text-10 uppercase tracking-[0.08em] text-muted-foreground'

/* The frame draws no rule above the note: the list simply ends and the line explains it. */
const NOTE = 'mx-14 my-0 font-sans text-11/15 text-muted-foreground'

const OPTION =
  'm-0 flex cursor-pointer items-start gap-10 border-0 bg-transparent px-14 py-8 text-left data-chosen:bg-veil-soft hover:bg-veil hover:outline-none focus-visible:bg-veil focus-visible:outline-none'

/**
 * `Open in VS Code`, with a chevron for the list behind it (T123). The button says the editor by
 * name so the boss knows what a click opens before clicking it; the list is what was found on
 * this Mac plus the system default, with a tick on the one in use.
 */
export function OpenWith({ editors, path = null, disabled, open, onToggle, onOpen, onChoose }: OpenWithProps) {
  const label = editorLabel(editors)
  const holder = useRef<HTMLSpanElement>(null)
  const close = useCallback(() => onToggle(false), [onToggle])

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) close()
    }
    const onEscape = (event: KeyboardEvent) => event.key === 'Escape' && close()
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open, close])

  return (
    <span className="relative inline-flex" ref={holder}>
      <span className={PAIR} data-disabled={disabled || undefined}>
        <Button
          variant="secondary"
          icon={SquarePen}
          className="rounded-r-none pr-8"
          disabled={disabled}
          onClick={onOpen}
        >
          {label}
        </Button>
        <button
          type="button"
          className={CHEVRON}
          aria-label={OPEN_WITH}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => onToggle(!open)}
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </span>
      {open && (
        <div className={MENU} role="menu" aria-label={OPEN_WITH}>
          <p className={HEAD}>{OPEN_WITH}</p>
          {editorOptions(editors, path, hostPlatform()).map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.chosen}
              className={OPTION}
              data-chosen={option.chosen || undefined}
              onClick={() => {
                onChoose(option.id)
                close()
              }}
            >
              <span className="inline-flex w-14 shrink-0 justify-center pt-3 text-brand-success" aria-hidden>
                {option.chosen && <Check size={14} />}
              </span>
              <span className="flex min-w-0 flex-col gap-2">
                <span className="font-sans font-semibold text-13/15 text-popover-foreground">{option.name}</span>
                <span className="font-sans text-11 text-muted-foreground">{option.detail}</span>
              </span>
            </button>
          ))}
          <p className={NOTE}>{OPEN_WITH_NOTE}</p>
        </div>
      )}
    </span>
  )
}
