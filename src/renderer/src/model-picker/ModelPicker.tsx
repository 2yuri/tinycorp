import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { Provider } from '../../../shared/domain/providers'
import type { ProviderPreflight } from '../../../shared/providers/preflight'
import { Badge, CHOICE_INPUT, cx, DropdownMenu, MenuDivider, MenuItem, ProviderMark } from '../ui'
import {
  closedField,
  effortField,
  MENU_MAX,
  type ModelChoice,
  menuHeight,
  modelGroups,
  SOMEONE,
  scrollerAround,
} from './model-picker'
import '../ui/tailwind.css'

export type { ModelChoice } from './model-picker'

/**
 * MODEL and EFFORT, the two controls of frame `CLSj9`.
 *
 * MODEL is one field that picks the Provider and the model together: closed it is the provider as
 * a chip and the model beside it, open it is the whole catalogue, one group per Provider with its
 * preflight state beside its name and each of its models once. Picking a model sets the Provider
 * that owns it, so there is no second product to keep in step and nothing that can reset a choice
 * behind the boss's back (T139).
 *
 * EFFORT sits under it, and is a choice of its own: the levels the catalogue lists for that model,
 * in the word its CLI takes — `--effort xhigh`, not a `deep` of ours. A model that takes no such
 * flag says so in a line, because an empty control reads as one that failed to load.
 *
 * The preflight state is read, never asked: it arrives as the answers the main process already has
 * (T135), so nothing here spawns a subprocess on a render path. A Provider whose CLI is not ready
 * is listed and greyed rather than hidden, and picking one of its models is allowed — it is how an
 * Employee is set up before the CLI is installed. The refusal at Start says the rest.
 *
 * Hiring, editing an Employee, editing a proposal and deciding one all draw this same component,
 * so the next change to it reaches every one of them.
 *
 * `inline` is the one-line form frame `bB6VX` draws under `CONTINUE ON`: the caller has already
 * written the label, so the field carries none of its own, and the level the model runs at is a
 * badge inside the field rather than a control under it. A Company's fallback rule picks a model;
 * which level that model runs at follows the model, as {@link entryForModel} already keeps it.
 */
export function ModelPicker(props: {
  /** The model id the form holds; null runs on the Provider's default. */
  value: string | null
  /** The Provider the Employee is stored on: what the chip says when the model is null or unknown. */
  provider: Provider
  onChange(choice: ModelChoice): void
  /** Every Provider's cached preflight answer; null until the first read comes back over the bridge. */
  preflight: readonly ProviderPreflight[] | null
  /** The Employee this field is about, named in the line under a field that cannot start. */
  who?: string
  /** Frame `bB6VX`'s one-line form: the caller labels it, and the effort is read out, not chosen. */
  inline?: boolean
}) {
  const { value, provider, preflight, inline = false } = props
  const choice: ModelChoice = { provider, model: value }
  const field = closedField(choice, preflight, props.who?.trim() || SOMEONE)
  const groups = modelGroups(choice, preflight)
  const effort = effortField(choice)
  const current = effort?.levels.find((level) => level.current) ?? null
  const [open, setOpen] = useState(false)
  const effortName = useId()
  const anchor = useRef<HTMLDivElement>(null)
  // Measured before the list is painted, so it opens at the height it keeps (T262).
  const [height, setHeight] = useState(MENU_MAX)
  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const scroller = scrollerAround(anchor.current)
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight
    setHeight(menuHeight(anchor.current.getBoundingClientRect().bottom, bottom))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div data-ui="Model Picker" className={cx(ROOT, inline ? 'gap-0' : 'gap-6')}>
      {!inline && (
        <span data-ui="Field Label" className={LABEL}>
          MODEL
        </span>
      )}
      <div className="relative w-full" ref={anchor}>
        <button
          type="button"
          aria-label="Model"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cx(FIELD, field.warning ? 'border-destructive' : 'border-input')}
          onClick={() => setOpen((shown) => !shown)}
        >
          {/* The provider, as a chip: its mark and its name, never a choice of its own. */}
          <span className={CHIP}>
            <ProviderMark provider={field.provider} size={12} />
            <span data-ui="Provider Name">{field.name}</span>
          </span>
          <span data-ui="Model Name" className={cx(MODEL, field.unknown ? UNKNOWN : 'text-13-5/normal')}>
            {field.model}
          </span>
          <span className="flex-1" />
          {inline && current && <Badge>{current.word}</Badge>}
          <ChevronDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
        {open && (
          <DropdownMenu className={MENU} style={{ maxHeight: height }} aria-label="Every model the Company knows">
            {groups.map((group, index) => {
              return (
                <fieldset key={group.provider} aria-label={group.name} className={GROUP}>
                  {index > 0 && <MenuDivider />}
                  {/* The mark sits in the tick's column, so a group header and its models share a left edge. */}
                  <div className={cx(GROUP_HEAD, group.blocked ? 'text-destructive' : 'text-muted-foreground')}>
                    <ProviderMark provider={group.provider} size={15} />
                    <span>{group.name}</span>
                    <span className="flex-1" />
                    {group.state && <span className={STATE}>{group.state}</span>}
                  </div>
                  {group.models.map((row) => (
                    <MenuItem
                      key={row.id ?? 'default'}
                      role="menuitemradio"
                      aria-checked={row.current}
                      className={cx(
                        ROW,
                        // The row with no tick keeps the ticked row's indent, so the names line up.
                        row.current ? CURRENT_ROW : 'pl-35',
                        // Not ready is listed, greyed, with the reason — the place you choose a model
                        // is where you find out.
                        group.blocked && !row.current && 'text-muted-foreground',
                      )}
                      {...(row.current && { icon: Check })}
                      label={<span className="min-w-0 flex-1 truncate">{row.name}</span>}
                      onClick={() => {
                        setOpen(false)
                        props.onChange({ provider: row.provider, model: row.id })
                      }}
                    />
                  ))}
                </fieldset>
              )
            })}
          </DropdownMenu>
        )}
      </div>
      {field.warning && (
        <p className="m-0 font-normal text-11 text-destructive" role="alert">
          {field.warning}
        </p>
      )}
      {!inline && effort && (
        <>
          <span data-ui="Field Label" className={LABEL}>
            EFFORT
          </span>
          {effort.note ? (
            // A model with no reasoning-effort flag at all: a sentence, never an empty control — in
            // the track's own box.
            <p className={NOTE}>{effort.note}</p>
          ) : (
            <div className={TRACK} role="radiogroup" aria-label="Effort">
              {effort.levels.map((level) => (
                <label key={level.id} className={cx(LEVEL, level.current && CURRENT_LEVEL)}>
                  <input
                    type="radio"
                    data-slot="choice-input"
                    className={CHOICE_INPUT}
                    name={effortName}
                    checked={level.current}
                    onChange={() => props.onChange({ provider: field.provider, model: level.id })}
                  />
                  {level.word}
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/*
 * The frame's measurements, as utilities (T210f). No `!` anywhere: `ui/tailwind.css` is in `@layer
 * base` and the kit in `@layer kit`, and `utilities` is above both (T208), so a utility on a
 * `button` beats `button { font: inherit; color: inherit }` and a utility on a Menu Item beats
 * `[data-slot=menu]-item` — on the element, which is where this screen's decisions belong.
 *
 * A size is a step of the scale, and `/normal` where the frame gave the line no measurement of its
 * own: the scale's default leading is a paragraph's, and a chip's word is not a paragraph.
 */
const ROOT = 'flex w-full flex-col font-sans leading-normal'

/** MODEL and EFFORT: 11/700/0.5 over the control, its box 13 tall. */
const LABEL = 'font-bold text-11 text-muted-foreground tracking-[0.5px]'

/** The 40px field, closed. */
const FIELD =
  'm-0 flex h-40 w-full cursor-pointer items-center gap-9 rounded-sm border bg-muted px-12 text-left text-foreground hover:border-ring focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none'

/** The frame's 19px provider pill. */
const CHIP =
  'flex h-19 shrink-0 items-center gap-5 rounded-full border border-border bg-card px-7 font-semibold text-11/normal text-muted-foreground'

const MODEL = 'min-w-0 truncate font-normal text-foreground'

/** A model no entry of the catalogue owns any more: shown as it is stored, never swapped out. */
const UNKNOWN = 'font-code text-12-5/normal'

/**
 * Open, it is the catalogue: one group per Provider, 560 wide, over the EFFORT track. Its height is
 * the room below the field (`menuHeight`), and reaching its end never hands the wheel on to the
 * form around it: one scroll area at a time (T262).
 */
const MENU =
  'absolute top-[calc(100%+6px)] left-0 z-40 w-[min(560px,100%)] gap-0 overflow-auto overscroll-contain p-0 [&_[data-slot=menu-divider]]:mx-[-6px]'

const GROUP = 'flex flex-col px-6 pb-6'

const GROUP_HEAD = 'flex items-center gap-10 px-10 pt-12 pb-8 font-bold text-11/normal uppercase tracking-[0.5px]'

/** The Provider's preflight state, beside its name: a sentence, so it drops the header's setting. */
const STATE = 'font-normal text-11-5/normal normal-case tracking-[normal]'

/** The frame's 32px rows: 8 + a 16px line + 8. */
const ROW = 'py-8 pr-10 text-13-5'

const CURRENT_ROW = 'bg-primary-subtle pl-10 text-foreground [&_svg]:text-primary'

/**
 * EFFORT: the levels the model takes, in the word its own CLI is handed — mono, because it is a
 * value passed through verbatim and not a word of ours. The frame's track is 34 tall with its stroke
 * inside: 1px stroke, 2px of track, a 28px level, 2px, 1px.
 */
const TRACK = 'flex h-34 w-full items-center gap-4 rounded-sm border border-input bg-card p-2'

const LEVEL =
  'm-0 h-28 min-w-0 flex-1 cursor-pointer rounded-[6px] border-0 bg-transparent px-10 font-code font-normal text-11-5/normal text-muted-foreground hover:text-foreground has-[>_[data-slot=choice-input]:focus-visible]:shadow-focus has-[>_[data-slot=choice-input]:focus-visible]:outline-none'

/*
 * The level the Employee is on. It is the ink and nothing else, because the ink is all the track
 * has ever drawn: `bg-primary` and `font-bold` were here too and neither reached the screen —
 * `bg-transparent` and `font-normal` on the level itself are emitted after them, and two utilities
 * of the same weight are decided by that order. `cx` resolves the pair the caller's way now, which
 * would have filled the current level for the first time; the frame very likely wants that (T150's
 * `CLSj9` draws it filled) but it is a change to this screen, not to how it is styled, so it is
 * written down in the pull request rather than arriving inside a refactor that is meant to change
 * no pixel (T216).
 */
const CURRENT_LEVEL = 'text-primary-foreground hover:text-primary-foreground'

const NOTE =
  'm-0 flex h-34 w-full items-center rounded-sm border border-input bg-card px-13 text-12-5/normal text-muted-foreground'
