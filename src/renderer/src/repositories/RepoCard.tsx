import {
  Download,
  Ellipsis,
  FlaskConical,
  FolderTree,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Hammer,
  Info,
  ListChecks,
  Lock,
  type LucideIcon,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import {
  hasChecks,
  REPO_RUNGS,
  type Repo,
  type RepoInspection,
  type RepoRung,
  RUNG_HELP,
  RUNG_LABEL,
} from '../../../shared/repos/repo'
import { Avatar, cx, DropdownMenu, forgeMark, MenuDivider, MenuItem, useDismiss } from '../ui'
import {
  CHIP,
  CHIP_LABEL,
  CHIP_PATH,
  DIVIDER,
  INSET_STROKE,
  RUNG_CHIP,
  RUNG_CHIP_ERROR,
  RUNG_CHIP_WARNING,
  RUNG_ERROR_LABEL,
  RUNG_LABEL_CLASS,
  RUNG_WARNING_LABEL,
  SPACER,
} from './repo-classes'
import {
  accessLine,
  accessOf,
  avatarSlots,
  type CommandKey,
  languageLine,
  repoForge,
  rungTone,
  stackCommands,
} from './repo-view-model'

/*
 * One repository's card (T210c), off `design/html/repositories.html`. The shared field, chip and
 * button lists are in `repo-classes.ts`; these are the card's own.
 */
const CARD = cx('relative flex w-full shrink-0 flex-col gap-14 rounded-md bg-card p-16', INSET_STROKE)
const HEAD = 'flex w-full items-center gap-12'
const ICON = 'flex h-38 w-38 shrink-0 items-center justify-center rounded-sm bg-secondary text-soft-ink'
const NAMES = 'flex min-w-0 flex-1 flex-col gap-3'
const NAME_ROW = 'flex min-w-0 items-center gap-8'
const NAME = 'overflow-hidden text-ellipsis whitespace-nowrap text-foreground text-15/18 font-bold'
const LANG = 'shrink-0 whitespace-nowrap text-muted-foreground text-11/13 font-normal'
const REMOTE_LINE =
  'overflow-hidden text-ellipsis whitespace-nowrap font-code text-muted-foreground text-12/16 font-normal'
const STATUS =
  'inline-flex shrink-0 items-center gap-6 rounded-full bg-secondary px-10 py-4 whitespace-nowrap text-soft-ink text-11/13 font-semibold'
const STATUS_DOT_READY = 'h-6 w-6 rounded-full bg-brand-success'
const STACK = 'flex w-full min-w-0 flex-wrap items-center gap-8'
const STACK_LABEL = 'text-muted-foreground text-10/12 font-bold tracking-[1px]'
/* No checks yet: a soft hint, not a warning. */
const HINT =
  'flex min-w-0 flex-1 items-center gap-9 rounded-sm bg-secondary px-12 py-9 text-muted-foreground [&_svg]:shrink-0'
const HINT_LABEL = 'min-w-0 flex-1 text-muted-foreground text-12/15 font-semibold'
const HINT_ACTION =
  'm-0 inline-flex shrink-0 cursor-pointer items-center justify-center gap-8 rounded-sm border border-border bg-transparent px-11 py-6 font-sans whitespace-nowrap text-foreground text-12/15 font-semibold hover:bg-[color-mix(in_srgb,var(--background)_40%,transparent)] focus-visible:shadow-focus focus-visible:outline-none'
const FOOT = 'flex w-full min-w-0 items-center gap-8'
const ACCESS = 'shrink-0 whitespace-nowrap text-muted-foreground text-11/13 font-normal'
/* The faces overlap by 8px, so the row reads as a stack rather than a list. */
const WHO = 'flex shrink-0 items-center [&>*+*]:-ml-8'
const AVATAR = 'text-soft-ink text-9'
const MENU = 'relative shrink-0'
const MENU_BUTTON =
  'm-0 flex h-34 w-34 cursor-pointer items-center justify-center rounded-sm border border-border bg-transparent p-0 text-muted-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] hover:text-foreground aria-expanded:bg-[color-mix(in_srgb,var(--secondary)_70%,transparent)] aria-expanded:text-foreground focus-visible:shadow-focus focus-visible:outline-none'
const MENU_POPOVER = 'absolute top-[calc(100%+4px)] right-0 z-5 w-200'
const MENU_LABEL = 'px-10 pt-6 pb-2 text-soft-ink text-10/13 font-bold tracking-[1px]'
/* The rung in force wears the tick, written by the rule rather than put in the markup. */
const MENU_RUNG_ON = 'text-foreground font-semibold after:ml-auto after:pl-8 after:content-["✓"]'
const RUNG_TONE: Record<string, string> = { warning: RUNG_CHIP_WARNING, error: RUNG_CHIP_ERROR }
const RUNG_TONE_LABEL: Record<string, string> = { warning: RUNG_WARNING_LABEL, error: RUNG_ERROR_LABEL }

/** What TinyCorp may do here, as the frame draws it: a merge, a PR, or a lock (decision 61). */
export const RUNG_ICON: Record<RepoRung, LucideIcon> = {
  merge: GitMerge,
  pr: GitPullRequest,
  local: Lock,
}

const COMMAND_ICON: Record<CommandKey, LucideIcon> = {
  install: Download,
  build: Hammer,
  test: FlaskConical,
  lint: Sparkles,
}

export interface RepoCardProps {
  repo: Repo
  inspection: RepoInspection | undefined
  worktreeRoot: string | undefined
  roles: RoleTemplate[]
  employees: Employee[]
  highlighted?: boolean
  onEdit(): void
  onRemove(): void
  /** Moves the repo up or down the ladder from the `…` menu. */
  onRung?: ((rung: RepoRung) => void) | undefined
}

/** One attached repo: its checks (or the soft "No checks yet" hint) and who may work in it. */
export function RepoCard(props: RepoCardProps) {
  const { repo, inspection } = props
  const checked = hasChecks(repo.stack)
  const language = languageLine(repo.stack)
  const access = accessOf(repo.name, props.roles, props.employees)
  const forge = repoForge(inspection)
  const ForgeMark = forgeMark(forge.forge)
  const avatars = avatarSlots(access.employees)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (props.highlighted) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [props.highlighted])

  return (
    <article ref={ref} className={CARD} data-repo-id={repo.id} aria-label={repo.name}>
      <div className={HEAD} data-card-head>
        <span className={ICON} role="img" aria-label={forge.title} title={forge.title}>
          <ForgeMark size={19} aria-hidden />
        </span>
        <div className={NAMES}>
          <div className={NAME_ROW}>
            <span className={NAME}>{repo.name}</span>
            {language && <span className={LANG}>{language}</span>}
          </div>
          <div className={REMOTE_LINE} title={repo.path}>
            {inspection?.remote ?? (inspection?.isGitRepo ? `No remote · ${repo.path}` : repo.path)}
          </div>
        </div>
        <RungChip rung={repo.rung} />
        <span className={STATUS} data-card-slot="status">
          <span className={STATUS_DOT_READY} aria-hidden />
          Ready
        </span>
        <RepoMenu rung={repo.rung} onEdit={props.onEdit} onRemove={props.onRemove} onRung={props.onRung} />
      </div>

      {checked ? (
        <div className={STACK}>
          <span className={STACK_LABEL}>CHECKS</span>
          {stackCommands(repo.stack).map(({ key, command }) => (
            <Chip key={key} icon={COMMAND_ICON[key]} label={command} title={`${key}: ${command}`} />
          ))}
        </div>
      ) : (
        <div className={STACK}>
          <div className={HINT} role="status">
            <Info size={15} aria-hidden />
            <span className={HINT_LABEL}>No checks yet — Employees can work here; whoever sets it up records them</span>
            <button type="button" className={HINT_ACTION} onClick={props.onEdit}>
              <ListChecks size={14} aria-hidden />
              Add checks
            </button>
          </div>
        </div>
      )}

      <div className={DIVIDER} />

      <div className={FOOT}>
        <Chip icon={GitBranch} label={inspection?.defaultBranch ?? '—'} title="Default branch" />
        <Chip
          icon={FolderTree}
          className={CHIP_PATH}
          label={props.worktreeRoot ?? '—'}
          title={props.worktreeRoot ? `Ticket worktrees are created in ${props.worktreeRoot}` : undefined}
        />
        <Chip icon={GitPullRequest} label="1 PR per repo" />
        <span className={SPACER} />
        <span className={ACCESS}>{accessLine(access.roles)}</span>
        {avatars.shown.length > 0 && (
          <span className={WHO}>
            {avatars.shown.map((employee) => (
              <Avatar
                key={employee.id}
                name={employee.name}
                person={{ id: employee.id, sprite: employee.sprite }}
                size={24}
                ring
                className={AVATAR}
              />
            ))}
            {avatars.more > 0 && (
              <Avatar
                name={`${avatars.more} more`}
                text={`+${avatars.more}`}
                size={24}
                tone="neutral"
                ring
                className={AVATAR}
              />
            )}
          </span>
        )}
      </div>
    </article>
  )
}

/** What TinyCorp may do to this repo, beside the state badge. */
export function RungChip(props: { rung: RepoRung }) {
  const Icon = RUNG_ICON[props.rung]
  return (
    <span
      className={RUNG_TONE[rungTone(props.rung)] ?? RUNG_CHIP}
      data-card-slot="chip"
      // The tone used to be legible in the class name; on utilities it is a set of colours.
      data-rung-tone={rungTone(props.rung)}
      title={RUNG_HELP[props.rung]}
    >
      <Icon size={12} aria-hidden />
      <span className={RUNG_TONE_LABEL[rungTone(props.rung)] ?? RUNG_LABEL_CLASS}>{RUNG_LABEL[props.rung]}</span>
    </span>
  )
}

function Chip(props: { icon: LucideIcon; label: string; title?: string | undefined; className?: string | undefined }) {
  const Icon = props.icon
  return (
    <span className={props.className ?? CHIP} title={props.title}>
      <Icon size={12} aria-hidden />
      <span className={CHIP_LABEL}>{props.label}</span>
    </span>
  )
}

export function RepoMenu(props: {
  rung?: RepoRung
  onEdit(): void
  onRemove(): void
  onRung?: ((rung: RepoRung) => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const dismiss = useDismiss<HTMLDivElement, HTMLElement>(open, () => setOpen(false))

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className={MENU} ref={dismiss.popover}>
      <button
        type="button"
        className={MENU_BUTTON}
        data-menu-button
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis size={16} aria-hidden />
      </button>
      {open && (
        <DropdownMenu className={MENU_POPOVER}>
          <MenuItem icon={Pencil} label="Edit repository" onClick={choose(props.onEdit)} />
          {props.rung && props.onRung && (
            <>
              <MenuDivider />
              <div className={MENU_LABEL}>WHAT TINYCORP MAY DO</div>
              {REPO_RUNGS.map((rung) => (
                <MenuItem
                  key={rung}
                  role="menuitemradio"
                  aria-checked={props.rung === rung}
                  icon={RUNG_ICON[rung]}
                  label={RUNG_LABEL[rung]}
                  title={RUNG_HELP[rung]}
                  className={props.rung === rung ? MENU_RUNG_ON : undefined}
                  onClick={choose(() => props.onRung?.(rung))}
                />
              ))}
              <MenuDivider />
            </>
          )}
          <MenuItem icon={Trash2} label="Remove repository" destructive onClick={choose(props.onRemove)} />
        </DropdownMenu>
      )}
    </div>
  )
}
