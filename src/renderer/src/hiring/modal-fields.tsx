/**
 * The fields both Employee modals draw — ROLE, NAME, PERMISSIONS and REPOSITORY ACCESS — and the
 * frame around them. Hiring one (frame `zf2Ks`) and editing one (frame `FbR2n`) are the same
 * anatomy over different data, so they draw these from here rather than each keeping a second copy
 * that can drift. Since T210f that includes the measurements: they were one stylesheet both files
 * imported, and they are one set of class lists both files import.
 */
import {
  BugPlay,
  Check,
  ClipboardList,
  CloudCog,
  Compass,
  FolderGit2,
  LayoutPanelTop,
  type LucideIcon,
  Plus,
  Server,
  ShieldCheck,
  Shuffle,
  Target,
  Users,
  X,
} from 'lucide-react'
import { useId, useState } from 'react'
import { MISSING_FOLDER_LINE, type SkillRow } from '../../../shared/catalogue/skills'
import {
  type Areas,
  EVERY_REPO,
  PERMISSION_CHOICE_LABEL,
  PERMISSION_MODES,
  type PermissionMode,
  type RepoFilter,
  type RoleTemplate,
  shutOutLine,
} from '../../../shared/domain/staff'
import { Alert, Button, CHOICE_INPUT, cx, focusOnMount, initialsOf } from '../ui'
import { addableRepos, selectedRepos, withoutRepo, withRepo } from './hire-model'
import '../ui/tailwind.css'

/** The design's icon per seeded role, by name; a role the catalog gained keeps the generic one. */
/** The glyph a role's name takes, wherever a role is drawn; anything else takes `Users`. */
const ROLE_ICON: Record<string, LucideIcon> = {
  PM: ClipboardList,
  'Tech Lead': Compass,
  Frontend: LayoutPanelTop,
  Backend: Server,
  DevOps: CloudCog,
  QA: BugPlay,
  HR: Users,
  PO: Target,
  Security: ShieldCheck,
}

/** The glyph for a role of this name, or the fallback every other role takes. */
export function roleIcon(name: string): LucideIcon {
  return ROLE_ICON[name] ?? Users
}

/** ROLE: the catalog as a chip grid, four to a row, with the picked one on the primary stroke. */
export function RoleGrid(props: {
  roles: RoleTemplate[]
  value: string
  onChange(role: RoleTemplate): void
  /** Opens the New role dialog over the modal; left out, the last chip is not drawn (T240). */
  onNewRole?: (() => void) | undefined
}) {
  const name = useId()
  return (
    <div data-ui="Field" className={FIELD}>
      <span data-ui="Field Label" className={LABEL} id="hire-role-label">
        ROLE
      </span>
      {/* ROLE: two rows of four chips in the seeded catalog; more roles wrap on. */}
      <div className="grid w-full grid-cols-4 gap-x-8 gap-y-6" role="radiogroup" aria-labelledby="hire-role-label">
        {props.roles.map((role) => {
          const Icon = roleIcon(role.name)
          const selected = role.id === props.value
          return (
            <label key={role.id} data-ui="Role" className={selected ? cx(ROLE, ROLE_PICKED) : cx(ROLE, ROLE_PLAIN)}>
              <input
                type="radio"
                data-slot="choice-input"
                className={CHOICE_INPUT}
                name={name}
                checked={selected}
                onChange={() => props.onChange(role)}
              />
              <Icon size={14} aria-hidden />
              <span data-ui="Role Label" className="truncate font-semibold text-12-5/normal">
                {role.name}
              </span>
            </label>
          )
        })}
        {/* A Company holds only the roles it uses (T240), so hiring into one it has not taken yet
            starts here rather than sending the boss to another screen and back. */}
        {props.onNewRole && (
          <button type="button" data-ui="Role" className={cx(ROLE, ROLE_NEW)} onClick={props.onNewRole}>
            <Plus size={14} aria-hidden />
            <span data-ui="Role Label" className="truncate font-semibold text-12-5/normal">
              New role…
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

/** NAME: the initials, the name itself, and the shuffle that asks the engine for another one. */
export function NameInput(props: {
  value: string
  autoFocus?: boolean
  onChange(name: string): void
  /** The shuffle button; left out, the field carries none. */
  onShuffle?: (() => void) | undefined
  /** What the shuffle does, for the boss who reads labels: hiring it rerolls the look too. */
  shuffleLabel?: string
}) {
  return (
    <label data-ui="Field" className={FIELD}>
      <span data-ui="Field Label" className={LABEL}>
        NAME
      </span>
      <span className={INPUT}>
        <span className={AVATAR} aria-hidden>
          {initialsOf(props.value.trim() || '?')}
        </span>
        <input
          data-ui="Name"
          className={CONTROL}
          value={props.value}
          ref={props.autoFocus ? focusOnMount : undefined}
          onChange={(event) => props.onChange(event.target.value)}
        />
        {props.onShuffle && (
          <button
            type="button"
            className={ACTION}
            aria-label={props.shuffleLabel ?? 'Suggest another name'}
            onClick={props.onShuffle}
          >
            <Shuffle size={14} aria-hidden />
          </button>
        )}
      </span>
    </label>
  )
}

/**
 * REPOSITORY ACCESS: the repos the filter resolves to, each droppable, and a menu of the ones it
 * does not hold yet. Editing a chip pins the filter to explicit names, so the chips the boss sees
 * are exactly what the Employee gets.
 */
export function RepoAccess(props: {
  value: RepoFilter
  repoNames: string[]
  onChange(filter: RepoFilter): void
  /** Drawn on the label row, e.g. the override marker when the Employee set its own (T138). */
  marker?: React.ReactNode
  /**
   * Who this filter would shut out of every repo, or null when it shuts nobody out (T239). The
   * caller works it out with `shutOutOfEveryRepo`, since only it knows whether they write code.
   */
  shutOut?: string | null
}) {
  const [adding, setAdding] = useState(false)
  const { value, repoNames } = props
  const chips = selectedRepos(value, repoNames)
  const addable = addableRepos(value, repoNames)
  return (
    <div data-ui="Field" className={FIELD}>
      <span className={LABEL_ROW}>
        <span data-ui="Field Label" className={LABEL} id="hire-repos-label">
          REPOSITORY ACCESS
        </span>
        {props.marker}
      </span>
      <fieldset className={CHIPS} aria-labelledby="hire-repos-label">
        {chips.map((repo) => (
          <span key={repo} data-ui="Chip" className={cx(CHIP, MONO_BOX, CHIP_PLAIN)}>
            <FolderGit2 size={12} aria-hidden />
            <span data-ui="Chip Label" className={cx(CHIP_LABEL, 'text-foreground')}>
              {repo}
            </span>
            <button
              type="button"
              className={CHIP_REMOVE}
              aria-label={`Remove ${repo}`}
              onClick={() => props.onChange(withoutRepo(value, repoNames, repo))}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <span className="relative inline-flex">
          <button
            type="button"
            data-ui="Chip"
            className={cx(CHIP, ADD_BOX, CHIP_PLAIN)}
            aria-expanded={adding}
            disabled={addable.length === 0}
            onClick={() => setAdding((open) => !open)}
          >
            <Plus size={12} aria-hidden />
            <span data-ui="Chip Label" className={cx(ADD_LABEL, 'text-muted-foreground')}>
              Add repository
            </span>
          </button>
          {adding && addable.length > 0 && (
            <ul className={ADD_MENU} aria-label="Repositories to add">
              {addable.map((repo) => (
                <li key={repo}>
                  <button
                    type="button"
                    className={ADD_OPTION}
                    onClick={() => {
                      setAdding(false)
                      props.onChange(withRepo(value, repoNames, repo))
                    }}
                  >
                    {repo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      </fieldset>
      {props.shutOut && <ShutOutWarning who={props.shutOut} onAllowAll={() => props.onChange(EVERY_REPO)} />}
    </div>
  )
}

/**
 * AREAS (T239): the paths inside a repo this role or Employee works in, comma-separated, the same
 * 40px field as NAME. It is how a monorepo tells a Frontend from a Backend now that both work in
 * every repo — a repo *name* cannot. Left empty, they work anywhere in the repos they may work in.
 */
export function AreasField(props: {
  value: Areas
  onChange(areas: Areas): void
  /** Drawn on the label row, e.g. the override marker when the Employee set its own. */
  marker?: React.ReactNode
}) {
  // Typed, not parsed: the boss is mid-word between two commas, and re-parsing every keystroke
  // would eat the separator they are about to type.
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed ?? props.value.join(', ')
  return (
    <label data-ui="Field" className={FIELD}>
      <span className={LABEL_ROW}>
        <span data-ui="Field Label" className={LABEL}>
          AREAS
        </span>
        {props.marker}
      </span>
      <span className={INPUT}>
        <input
          data-ui="Areas"
          className={CONTROL}
          placeholder="src/renderer/**, packages/api/**"
          value={text}
          onChange={(event) => {
            setTyped(event.target.value)
            props.onChange(parseAreas(event.target.value))
          }}
          onBlur={() => setTyped(null)}
        />
      </span>
      <p data-ui="Field Help" className={HELP}>
        The paths inside a repo they own. A ticket whose paths or labels fall in here comes to them first. Empty is the
        whole repo.
      </p>
    </label>
  )
}

/** Areas as typed: comma-separated paths, blanks dropped. */
function parseAreas(text: string): Areas {
  return text
    .split(',')
    .map((area) => area.trim())
    .filter(Boolean)
}

/**
 * Said wherever a repo filter is set and lets an Employee into nothing (T239): a filter that shuts
 * someone out is the whole reason work piles up on whoever is left, and it used to be silent.
 * "Allow all repos" is the one click that undoes it.
 */
export function ShutOutWarning(props: { who: string; onAllowAll(): void; className?: string }) {
  return (
    <Alert variant="warning" title={shutOutLine(props.who)} className={cx(SHUT_OUT_ALERT, props.className)}>
      <span>
        No repo of this Company matches their filter, so they can pick up no work and every ticket lands on whoever is
        left.
      </span>
      <Button type="button" size="sm" variant="outline" icon={FolderGit2} onClick={props.onAllowAll}>
        Allow all repos
      </Button>
    </Alert>
  )
}

/** The alert's body is a column, so the button sits under the sentence — as `InitialiseRepoAlert` has it. */
const SHUT_OUT_ALERT =
  '[&_[data-slot=alert-body]]:flex [&_[data-slot=alert-body]]:flex-col [&_[data-slot=alert-body]]:items-start [&_[data-slot=alert-body]]:gap-8'

/** One thing a chip row can hand out: its id and the word the chip carries. */
export interface GrantChip {
  id: string
  label: string
  /** What is true about it now, said on the chip itself — a skill folder that has moved (T137). */
  note?: string
}

/**
 * The SKILLS row's chips (T137). A skill folder that is not where the boss left it says so on its
 * own chip: it is still granted, and the Employee simply starts without it.
 */
export function skillChips(skills: readonly SkillRow[]): GrantChip[] {
  return skills.map((skill) => ({
    id: skill.id,
    label: skill.name,
    ...(skill.missing && { note: MISSING_FOLDER_LINE }),
  }))
}

/**
 * A row of chips the boss turns on and off — the MCP servers of the Company's catalogue, the
 * capabilities an Employee holds. An on chip carries a check, as the frames draw it; `line` is the
 * sentence under the row that says where the grants came from (T138).
 */
export function GrantChips(props: {
  label: string
  items: GrantChip[]
  value: string[]
  onChange(ids: string[]): void
  /** The icon each chip carries; the frames draw one for servers and none for capabilities. */
  icon?: LucideIcon
  /** Drawn on the label row, e.g. the override marker. */
  marker?: React.ReactNode
  /** The generated line under the row; a row that has nothing to say carries none. */
  line?: React.ReactNode
  /** Shown in place of the chips when there is nothing to hand out. */
  empty?: React.ReactNode
}) {
  const { items, value, icon: Icon } = props
  const id = `hire-grants-${props.label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div data-ui="Field" className={FIELD}>
      <span className={LABEL_ROW}>
        <span data-ui="Field Label" className={LABEL} id={id}>
          {props.label}
        </span>
        {props.marker}
      </span>
      {items.length === 0 && props.empty !== undefined ? (
        props.empty
      ) : (
        <fieldset className={CHIPS} aria-labelledby={id}>
          {items.map((item) => {
            const on = value.includes(item.id)
            return (
              <button
                key={item.id}
                type="button"
                role="switch"
                aria-checked={on}
                data-ui="Chip"
                className={cx(CHIP, MONO_BOX, on ? CHIP_ON : CHIP_OFF)}
                // The row's own order, so turning one on never reshuffles the rest.
                onClick={() =>
                  props.onChange(items.filter((i) => (i.id === item.id ? !on : value.includes(i.id))).map((i) => i.id))
                }
              >
                {on ? <Check size={12} aria-hidden /> : Icon && <Icon size={12} aria-hidden />}
                <span data-ui="Chip Label" className={cx(CHIP_LABEL, on ? 'text-primary' : 'text-muted-foreground')}>
                  {item.label}
                </span>
                {/* A folder that is not where the boss left it says so on its own chip, rather than
                    being handed out quietly (T137). */}
                {item.note && (
                  <span className="whitespace-nowrap text-10-5/normal text-status-warning-foreground">{item.note}</span>
                )}
              </button>
            )
          })}
        </fieldset>
      )}
      {props.line !== undefined && (
        <p data-ui="Field Help" className={HELP}>
          {props.line}
        </p>
      )}
    </div>
  )
}

/**
 * PERMISSIONS (frames `XJxrZ`, `PGtFO`, `V0AWNP`): two chips and the line under them. Whether the
 * Employee's Session runs without stopping to ask, or asks first — the same control on Hire, on
 * Edit and, as the Company's default for the next hire, in Company settings.
 *
 * The chips carry the choice in the boss's words. What either one puts on a command line is the
 * Provider adapter's business and is never named here.
 */
export function PermissionField(props: {
  value: PermissionMode
  onChange(mode: PermissionMode): void
  /** The line under the chips; each of the three frames words it for its own screen. */
  help: string
  /** Drawn on the label row, e.g. the override marker on Edit Employee. */
  marker?: React.ReactNode
  /** Unique when two of these are on one page; the label and the group are tied by it. */
  id?: string
}) {
  const id = props.id ?? 'permissions'
  const permissionName = useId()
  return (
    <div data-ui="Field" className={FIELD}>
      <span className={LABEL_ROW}>
        <span data-ui="Field Label" className={LABEL} id={`${id}-label`}>
          PERMISSIONS
        </span>
        {props.marker}
      </span>
      <div className={CHIPS} role="radiogroup" aria-labelledby={`${id}-label`}>
        {PERMISSION_MODES.map((mode) => {
          const on = props.value === mode
          return (
            <label key={mode} data-ui="Chip" className={cx(CHIP, WORDS_BOX, on ? CHIP_ON : CHIP_OFF)}>
              <input
                type="radio"
                data-slot="choice-input"
                className={CHOICE_INPUT}
                name={permissionName}
                checked={on}
                onChange={() => props.onChange(mode)}
              />
              {on && <Check size={12} aria-hidden />}
              <span data-ui="Chip Label" className={cx(WORDS_LABEL, on ? 'text-primary' : 'text-muted-foreground')}>
                {PERMISSION_CHOICE_LABEL[mode]}
              </span>
            </label>
          )
        })}
      </div>
      <p data-ui="Field Help" className={HELP}>
        {props.help}
      </p>
    </div>
  )
}

/*
 * The frames' measurements, as utilities (T210f). They live here because both Employee modals draw
 * them — hiring one (`zf2Ks`) and editing one (`FbR2n`) are the same anatomy over different data —
 * and a second copy in the other file is exactly the drift this module exists to prevent.
 *
 * `hire-modal.css` reached its focus ring from the label: a ROLE tile and a PERMISSIONS chip are a
 * label over a real radio (T190), so the ring the browser drew around the button is drawn on the
 * label from the control's own focus. That is `has-[>_[data-slot=choice-input]:focus-visible]:` here.
 */
/*
 * The frame around the fields: 660px, a 16/20 header, 16/20 of form and a 14/20 footer.
 *
 * `#0b1220cc` is the overlay's own wash and `#00000066` the modal's shadow — the frames' own, and
 * no token names either. The overlay starts under the title bar's 44px, so the window's own chrome
 * stays lit.
 */
export const OVERLAY =
  'fixed inset-x-0 top-44 bottom-0 z-30 flex items-center justify-center bg-[#0b1220cc] p-24 font-sans leading-normal'

export const MODAL =
  'm-0 flex max-h-full w-660 flex-col rounded-md border border-border bg-card shadow-[0px_16px_40px_0px_#00000066]'

export const HEADER = 'flex shrink-0 items-center gap-12 border-b border-b-border px-20 py-16'

export const HEADER_TEXT = 'flex min-w-0 flex-1 basis-0 flex-col gap-2'

export const TITLE = 'font-bold text-16/18 text-foreground'

export const SUBTITLE = 'font-normal text-11-5/13 text-muted-foreground'

export const CLOSE =
  'flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground'

export const FORM = 'flex flex-col gap-14 overflow-auto px-20 py-16'

/** LOOK beside NAME and MODEL. */
export const IDENTITY = 'flex w-full items-start gap-12'

export const FIELDS = 'flex min-w-0 flex-1 basis-0 flex-col gap-12'

export const TEXTAREA =
  'h-72 w-full resize-none rounded-sm border border-border bg-card px-12 py-10 font-[inherit] font-normal text-12-5/19 text-muted-foreground focus:border-ring focus:shadow-focus focus:outline-none'

/** A 1px rule with no text to floor it: in the scrolling form it would shrink to nothing. */
export const DIVIDER = 'h-1 w-full shrink-0 bg-border'

export const ERROR = 'm-0 text-12/normal text-status-error-foreground'

export const FOOTER = 'flex shrink-0 items-center gap-10 border-t border-t-border px-20 py-14'

export const NOTE = 'flex min-w-0 flex-1 basis-0 items-center gap-7 text-muted-foreground'

export const NOTE_TEXT = 'flex-1 basis-0 font-normal text-11-5/14'

const BUTTON =
  'flex shrink-0 cursor-pointer items-center justify-center gap-8 rounded-sm border-0 px-16 py-9 font-[inherit] font-semibold text-13-5/16'

export const CANCEL = cx(
  BUTTON,
  'bg-transparent text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)]',
)

export const SUBMIT = cx(
  BUTTON,
  'bg-primary text-primary-foreground shadow-button-primary not-disabled:hover:bg-primary-hover disabled:cursor-default disabled:opacity-50',
)

export const FIELD = 'flex w-full flex-col gap-6'

/** A field's own heading: 11/700/0.5 over the control, its box 13 tall. */
export const LABEL = 'font-bold text-11 text-muted-foreground tracking-[0.5px]'

/** A label with something beside it: the override marker a field carries when it is the Employee's own. */
export const LABEL_ROW = 'flex min-h-13 items-center gap-10'

/** The generated line under a chip row: where its grants came from (T138). */
export const HELP = 'mt-2 mr-0 mb-0 ml-0 font-normal text-11-5/15 text-muted-foreground'

/** One ROLE tile: 36 tall, and the picked one takes the primary stroke and wash. */
const ROLE =
  'flex h-36 min-w-0 cursor-pointer items-center justify-center gap-7 rounded-sm border px-10 [font:inherit] has-[>_[data-slot=choice-input]:focus-visible]:shadow-focus has-[>_[data-slot=choice-input]:focus-visible]:outline-none'

const ROLE_PLAIN =
  'border-border bg-card text-muted-foreground hover:border-[color-mix(in_srgb,var(--primary)_50%,var(--border))]'

const ROLE_PICKED = 'border-primary bg-primary-subtle text-foreground'

/** `New role…`: the same tile, dashed, because it opens a dialog rather than picking anything. */
const ROLE_NEW =
  'border-border border-dashed bg-transparent text-muted-foreground hover:border-[color-mix(in_srgb,var(--primary)_50%,var(--border))]'

/** NAME and MODEL share the frames' 40px field. */
const INPUT =
  'relative flex h-40 w-full items-center gap-8 rounded-sm border border-border bg-card px-12 text-muted-foreground focus-within:border-ring focus-within:shadow-focus'

const CONTROL =
  'min-w-0 flex-1 basis-0 truncate border-0 bg-transparent font-[inherit] font-normal text-13-5/normal text-foreground focus:outline-none'

const AVATAR =
  'flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-primary-subtle font-bold text-10/normal text-primary'

const ACTION =
  'flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground'

/** REPOSITORY ACCESS, MCP SERVERS, SKILLS, PERMISSIONS: a row of chips that wraps. */
const CHIPS = 'flex w-full flex-wrap items-center gap-8'

/*
 * One chip. Its box and its surface are on the variant and never here: two utilities of the same
 * property on one element are settled by the order Tailwind emitted them in, not by the order they
 * are written, and this chip has four forms.
 */
const CHIP =
  'flex items-center rounded-full border [font:inherit] has-[>_[data-slot=choice-input]:focus-visible]:shadow-focus has-[>_[data-slot=choice-input]:focus-visible]:outline-none'

const MONO_BOX = 'gap-6 px-11 py-6'

/**
 * A chip that says a phrase rather than names a thing is set in the sans, as the frames set it, and
 * is 27 tall where a mono one is 28 — `QgXdU`, `zf2Ks` and `FbR2n` all draw it so. Its 15px line
 * takes the pixel back out of the padding rather than adding one.
 */
const WORDS_BOX = 'gap-6 px-10 py-5'

const ADD_BOX = 'gap-5 px-11 py-6 cursor-pointer disabled:cursor-default disabled:opacity-50'

/** A chip that is not a choice: it names a thing the Employee has, and reads as the row it is in. */
const CHIP_PLAIN = 'border-transparent bg-secondary text-muted-foreground'

const CHIP_LABEL = 'whitespace-nowrap font-code font-semibold text-11-5/14'

const WORDS_LABEL = 'whitespace-nowrap font-sans font-medium text-12/15'

/** A grant the Employee holds: the check and the chip take the primary stroke. */
const CHIP_ON = 'cursor-pointer border-primary bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary'

const CHIP_OFF =
  'cursor-pointer border-border bg-transparent text-muted-foreground hover:border-[color-mix(in_srgb,var(--primary)_50%,var(--border))]'

const CHIP_REMOVE =
  'flex cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground'

const ADD_LABEL = 'whitespace-nowrap font-sans font-semibold text-12/14'

const ADD_MENU =
  'absolute top-[calc(100%+6px)] left-0 z-1 m-0 max-h-180 min-w-160 list-none overflow-auto rounded-sm border border-border bg-popover p-4 shadow-menu'

const ADD_OPTION =
  'block w-full cursor-pointer rounded-sm border-0 bg-transparent px-8 py-6 text-left font-code text-11-5/normal text-foreground hover:bg-secondary'
