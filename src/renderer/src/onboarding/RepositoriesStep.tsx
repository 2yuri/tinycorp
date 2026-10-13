import {
  ChevronRight,
  FolderSearch,
  GitBranch,
  Info,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { Company } from '../../../shared/company'
import { folderOfInterest } from '../../../shared/repos/found-repos'
import type { RepoInspection } from '../../../shared/repos/repo'
import { machineWordsHere } from '../chrome'
import { resources, useIpcResource } from '../ipc'
import {
  accessChanges,
  accessOf,
  BriefField,
  type FoundRepos,
  FoundReposPicker,
  InitialiseRepoAlert,
  RepoMenu,
  StackPanel,
  useFoundRepos,
  workingRoles,
} from '../repositories'
import { cx, RepoMarkIcon } from '../ui'
import '../ui/tailwind.css'
import { type ConnectedCard, connectedCards, connectedLabel, foundLabel, repoCounts } from './repositories-step-model'

/*
 * The Repositories step's classes (T210c), off frame `Desktop App / Onboarding / Repositories`.
 * The wizard's window sets the line box to the font's own, so sizes pin `/[normal]` unless a rule
 * measured one.
 *
 * Two lists reach into the Repositories folder's own components — the card's ⋯ and the Define
 * stack panel — as descendant variants, which is what the stylesheet did. They read the
 * `data-menu-button` and `data-repo-panel` those components carry, rather than a class name.
 */
const STEP = 'flex min-h-0 w-full shrink-0 items-start gap-20'
const LIST = 'flex min-w-0 flex-1 flex-col gap-10'
const LABEL = 'whitespace-nowrap text-muted-foreground text-11/[normal] font-bold tracking-[0.6px]'
const GAP = 'h-6 shrink-0'
const LIST_ERROR = 'm-0 rounded-sm bg-status-error px-12 py-10 text-status-error-foreground text-12/[normal]'
const SPACER = 'flex-1'
const CARD = 'flex w-full flex-col gap-12 rounded-md border border-border bg-card p-15'
const CARD_TOP =
  'flex items-center gap-12 [&_[data-menu-button]]:h-16 [&_[data-menu-button]]:w-16 [&_[data-menu-button]]:border-0'
const TILE = 'flex h-34 w-34 shrink-0 items-center justify-center rounded-sm bg-secondary text-soft-ink'
const CARD_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const CARD_LINE = 'flex items-center gap-8'
const CARD_NAME = 'whitespace-nowrap font-code text-foreground text-14/[normal] font-bold'
const BRANCH =
  'flex shrink-0 items-center gap-5 rounded-full bg-secondary px-9 py-3 font-code whitespace-nowrap text-soft-ink text-10-5/[normal] font-semibold [&_svg]:text-muted-foreground'
const CARD_PATH = 'overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-11-5/[normal]'
const STATUS =
  'm-0 flex shrink-0 items-center gap-5 rounded-full border-0 px-10 py-5 font-sans whitespace-nowrap text-11/[normal] font-semibold'
const STATUS_READY = cx(STATUS, 'bg-status-success text-status-success-foreground')
const STATUS_HINT = cx(STATUS, 'cursor-pointer bg-secondary text-muted-foreground')
const BRIEF = 'flex w-full'
const STACK = 'flex flex-wrap items-center gap-7'
const COMMAND = 'flex min-w-0 items-center gap-6 rounded-full border border-border bg-card px-9 py-4 whitespace-nowrap'
const KEY = 'text-muted-foreground text-10-5/[normal] font-bold'
const CMD = 'overflow-hidden text-ellipsis font-code text-soft-ink text-11/[normal]'
const DIVIDER = 'h-1 w-full bg-border'
const ACCESS = 'flex flex-wrap items-center gap-8'
const ACCESS_LABEL = 'whitespace-nowrap text-muted-foreground text-11-5/[normal]'
const ROLE =
  'm-0 rounded-full border-0 bg-secondary px-10 py-4 font-sans whitespace-nowrap text-soft-ink text-11/[normal] font-semibold'
const ROLE_ON = cx(ROLE, 'cursor-pointer')
/* Off is a dashed outline, and gives the pixel the border takes back from the padding. */
const ROLE_OFF =
  'm-0 cursor-pointer rounded-full border border-dashed border-border bg-transparent px-9 py-3 font-sans whitespace-nowrap text-muted-foreground text-11/[normal] font-semibold'
const CHANGE =
  'm-0 cursor-pointer border-0 bg-transparent p-0 font-sans whitespace-nowrap text-primary text-11-5/[normal] font-semibold hover:text-primary-hover'
const ADD =
  'm-0 flex w-full cursor-pointer items-center gap-10 rounded-sm border border-border bg-card px-13 py-11 text-left font-sans text-muted-foreground hover:bg-secondary'
// The `setup-found*` rows the stylesheet styled are gone: 40 lines of rules no component has
// written since the found list became `FoundRepos` in the Repositories folder.
const ADD_LABEL = 'flex-1 text-soft-ink text-12-5/[normal] font-semibold'
const RULES = 'flex w-320 shrink-0 flex-col gap-14 rounded-md border border-border bg-card p-19'
const RULES_HEAD = 'flex flex-col gap-3'
const RULES_TITLE = 'whitespace-nowrap text-foreground text-15/[normal] font-bold'
const RULES_SUB = 'text-muted-foreground text-11-5/[normal]'
const RULE = 'm-0 flex items-start gap-10 text-soft-ink text-12/17 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'
const RULES_DIVIDER = 'h-1 w-full bg-border'
const COUNTS = 'm-0 flex flex-col gap-14'
const COUNT =
  'flex items-center gap-8 [&_dt]:flex-1 [&_dt]:text-muted-foreground [&_dt]:text-12-5/[normal] [&_dd]:m-0 [&_dd]:font-code [&_dd]:text-foreground [&_dd]:text-12/[normal] [&_dd]:font-semibold'
const WARNING =
  'm-0 flex items-start gap-9 rounded-sm bg-status-warning p-12 text-status-warning-foreground text-11-5/17 [&_svg]:mt-1 [&_svg]:shrink-0'
/* Define stack, in place of the rules card; the panel's own trailing rule is off in here. */
const PANEL = 'flex h-600 shrink-0 overflow-hidden rounded-md border border-border [&_[data-repo-panel]]:after:hidden'

/** The working roles offered while `Change` is open on a card. */
export interface AccessEdit {
  repoId: string
  roles: { id: string; name: string; allowed: boolean }[]
}

export interface RepositoriesStepViewProps {
  cards: ConnectedCard[]
  /** The repos found in the folder beside the Company's own, as the boss ticks them (T168). */
  found: FoundRepos
  counts: { connected: number; described: number; selected: number; found: number }
  /** How the Connected count is named: `Connected (core)` while the names fit. */
  connectedLabel: string
  access: AccessEdit | null
  error: string | null
  /** A folder picked from anywhere that has no `.git` yet, offered to be initialised. */
  uninitialised?: string | null
  /** Shown in place of How repos are used, e.g. the Edit repository panel. */
  panel?: ReactNode
  onAddAnywhere(): void
  /** An empty folder: start a repo in it, as T144 does. */
  onStartHere(folder: string): void
  /** The uninitialised folder became a repo: connect it. */
  onInitialised?(path: string): void
  onEditRepo(repoId: string): void
  /** Saves a connected repo's brief, typed on its card. */
  onBrief(repoId: string, brief: string): void
  onDisconnect(repoId: string): void
  onChangeAccess(repoId: string): void
  onToggleRole(roleId: string): void
  onDoneAccess(): void
}

/** Step 4 of the setup wizard (design/html/onboarding-repositories.html, frame `Desktop App / Onboarding / Repositories`). */
export function RepositoriesStepView(props: RepositoriesStepViewProps) {
  return (
    <div className={STEP}>
      <div className={LIST}>
        {props.error && (
          <p className={LIST_ERROR} role="alert">
            {props.error}
          </p>
        )}
        {props.cards.length > 0 && (
          <>
            <span className={LABEL}>CONNECTED</span>
            {props.cards.map((card) => (
              <ConnectedRepo
                {...props}
                key={card.id}
                card={card}
                access={props.access?.repoId === card.id ? props.access : null}
              />
            ))}
            <span className={GAP} />
          </>
        )}
        {props.found.folder !== null && (
          <>
            <span className={LABEL}>{foundLabel(props.found.folder, props.found.counts.repos)}</span>
            <FoundReposPicker state={props.found} onStartHere={props.onStartHere} />
          </>
        )}
        {props.uninitialised && (
          <InitialiseRepoAlert
            path={props.uninitialised}
            onInitialised={() => props.onInitialised?.(props.uninitialised!)}
          />
        )}
        <button type="button" className={ADD} onClick={props.onAddAnywhere}>
          <FolderSearch size={15} aria-hidden />
          <span className={ADD_LABEL}>Add a repository from anywhere on {machineWordsHere().machine}</span>
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      {props.panel ?? (
        <aside className={RULES} aria-label="How repos are used">
          <div className={RULES_HEAD}>
            <span className={RULES_TITLE}>How repos are used</span>
            <span className={RULES_SUB}>The rules every employee works under.</span>
          </div>
          <p className={RULE}>
            <GitBranch size={15} aria-hidden />
            <span>Each ticket gets its own worktree outside the repo folder — your working tree is never touched.</span>
          </p>
          <p className={RULE}>
            <Terminal size={15} aria-hidden />
            <span>Checks run before every PR once they exist. A new repo can start without them.</span>
          </p>
          <p className={RULE}>
            <ShieldCheck size={15} aria-hidden />
            <span>Nobody can read or write outside the repos you connect here.</span>
          </p>
          <span className={RULES_DIVIDER} />
          <dl className={COUNTS}>
            <Count label={props.connectedLabel} value={props.counts.connected} />
            <Count label="Described" value={props.counts.described} />
            <Count label="Selected to connect" value={props.counts.selected} />
            <Count label="Found, not selected" value={props.counts.found} />
          </dl>
          {props.counts.selected > 0 ? (
            <>
              <span className={RULES_DIVIDER} />
              <p className={WARNING} role="status">
                <TriangleAlert size={14} aria-hidden />
                <span>
                  Nothing is added until you continue. Each one comes in with its checks detected and a brief you can
                  fill in afterwards.
                </span>
              </p>
            </>
          ) : (
            props.counts.connected === 0 && (
              <>
                <span className={RULES_DIVIDER} />
                <p className={WARNING} role="status">
                  <TriangleAlert size={14} aria-hidden />
                  <span>Connect at least one repo, or the team has nowhere to work.</span>
                </p>
              </>
            )
          )}
        </aside>
      )}
    </div>
  )
}

function Count(props: { label: string; value: number }) {
  return (
    <div className={COUNT}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  )
}

function ConnectedRepo(props: RepositoriesStepViewProps & { card: ConnectedCard; access: AccessEdit | null }) {
  const { card, access } = props
  return (
    <div className={CARD} data-repo={card.name}>
      <div className={CARD_TOP}>
        <span className={TILE}>
          <RepoMarkIcon size={17} />
        </span>
        <span className={CARD_TEXT}>
          <span className={CARD_LINE}>
            <span className={CARD_NAME}>{card.name}</span>
            {card.branch && (
              <span className={BRANCH}>
                <GitBranch size={11} aria-hidden />
                {card.branch}
              </span>
            )}
          </span>
          <span className={CARD_PATH}>{card.pathLine}</span>
        </span>
        {card.checksDetected ? (
          <span className={STATUS_READY}>
            <Sparkles size={12} aria-hidden />
            Checks detected
          </span>
        ) : (
          <button
            type="button"
            className={STATUS_HINT}
            title="Employees can work here; whoever sets it up records them"
            onClick={() => props.onEditRepo(card.id)}
          >
            <Info size={12} aria-hidden />
            No checks yet
          </button>
        )}
        <RepoMenu onEdit={() => props.onEditRepo(card.id)} onRemove={() => props.onDisconnect(card.id)} />
      </div>
      <CardBrief
        key={`${card.id}:${card.brief}`}
        brief={card.brief}
        onSave={(brief) => props.onBrief(card.id, brief)}
      />
      {card.commands.length > 0 && (
        <div className={STACK}>
          {card.commands.map(({ key, command }) => (
            <span key={key} className={COMMAND}>
              <span className={KEY}>{key}</span>
              <span className={CMD}>{command}</span>
            </span>
          ))}
        </div>
      )}
      <span className={DIVIDER} />
      <div className={ACCESS}>
        <span className={ACCESS_LABEL}>Who can work here</span>
        {access ? (
          access.roles.map((role) => (
            <button
              key={role.id}
              type="button"
              aria-pressed={role.allowed}
              className={role.allowed ? ROLE_ON : ROLE_OFF}
              onClick={() => props.onToggleRole(role.id)}
            >
              {role.name}
            </button>
          ))
        ) : card.roles.length > 0 ? (
          card.roles.map((name) => (
            <span key={name} className={ROLE}>
              {name}
            </span>
          ))
        ) : (
          <span className={ACCESS_LABEL}>Nobody yet</span>
        )}
        <span className={SPACER} />
        <button
          type="button"
          className={CHANGE}
          onClick={() => (access ? props.onDoneAccess() : props.onChangeAccess(card.id))}
        >
          {access ? 'Done' : 'Change'}
        </button>
      </div>
    </div>
  )
}

/** The card's brief, saved when the field loses focus with a change. */
function CardBrief(props: { brief: string; onSave(brief: string): void }) {
  const [draft, setDraft] = useState(props.brief)
  return (
    // The field inside saves when focus leaves it; `onBlur` is where React puts that, and a blur is
    // not an interaction a role could describe.
    // biome-ignore lint/a11y/noStaticElementInteractions: it watches focus leaving, it starts nothing.
    <div
      className={BRIEF}
      onBlur={() => {
        if (draft.trim() !== props.brief) props.onSave(draft)
      }}
    >
      <BriefField compact label="About this repo" rows={1} value={draft} onChange={setDraft} />
    </div>
  )
}

const api = () => window.tinyCorp

/** The Repositories step bound to the engine: the Company's repos, the ones beside them, and the role filters. */
export function RepositoriesStep(props: {
  company: Company
  onConnectedChange(count: number): void
  /**
   * What Continue will do: how many repos are ticked and the one call that adds them. Nothing is
   * added while the boss ticks — the step says so — so the wizard runs this before it moves on.
   */
  onPending?(pending: { count: number; commit(): Promise<void> }): void
}) {
  const { onConnectedChange, onPending } = props
  const repos = useIpcResource(resources.repos)
  const roles = useIpcResource(resources.roles)
  const employees = useIpcResource(resources.employees)
  const [inspections, setInspections] = useState<Record<string, RepoInspection>>({})
  const [access, setAccess] = useState<{ repoId: string; allowed: Set<string> } | null>(null)
  const [editFor, setEditFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uninitialised, setUninitialised] = useState<string | null>(null)
  /** A folder the boss picked that is not a repo itself: walked for the repos inside it (T278). */
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // What the checkouts on disk say, read again whenever the repos themselves change.
  useEffect(() => {
    onConnectedChange(repos.length)
    void Promise.all(repos.map((repo) => api().repos.inspect(repo.path))).then((read) => {
      setInspections(Object.fromEntries(repos.map((repo, i) => [repo.id, read[i]!])))
    })
  }, [repos, onConnectedChange])

  async function attach(paths: string[]) {
    if (paths.length === 0) return
    const result = await api().repos.attachScanned(paths)
    if (!result.ok) throw new Error(result.error)
    const refused = result.value.failed
    if (refused.length > 0) throw new Error(refused.map((one) => one.error).join('; '))
  }

  async function saveAccess(repoName: string, allowed: ReadonlySet<string>) {
    for (const role of accessChanges(repoName, allowed, repos, roles)) {
      const result = await api().staff.updateRole(role.id, { repoFilter: role.repoFilter })
      if (!result.ok) throw new Error(result.error)
    }
  }

  const allowedFor = (repoName: string) => new Set(accessOf(repoName, roles, employees).roles.map((role) => role.id))
  const repoById = (id: string) => repos.find((repo) => repo.id === id)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const found = useFoundRepos(picked ?? folderOfInterest(props.company.folder, repos[0]?.path ?? null), repos)
  // Only a picked folder with no repo anywhere inside it is offered as a new one (T278).
  const emptyPick = picked !== null && found.walk !== null && !found.rows.some((row) => row.where !== '')
  const { chosen } = found
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attach` is rebuilt every render and closes over nothing else that changes.
  useEffect(() => {
    onPending?.({ count: chosen.length, commit: () => attach(chosen) })
    // `attach` is rebuilt every render and closes over nothing else that changes.
  }, [onPending, chosen])

  const editing = editFor ? repoById(editFor) : undefined
  const panel = editing ? (
    <div className={PANEL}>
      <StackPanel
        key={editing.id}
        mode="edit"
        name={editing.name}
        path={editing.path}
        inspection={inspections[editing.id] ?? null}
        initialBrief={editing.brief}
        initialStack={editing.stack}
        initialRung={editing.rung}
        roles={roles}
        initialAllowed={allowedFor(editing.name)}
        error={error}
        busy={busy}
        onCancel={() => setEditFor(null)}
        onSave={({ brief, stack, allowed, rung }) =>
          void run(async () => {
            const updated = await api().repos.update(editing.id, { brief, stack, rung })
            if (!updated.ok) throw new Error(updated.error)
            await saveAccess(editing.name, allowed)
            setEditFor(null)
          })
        }
      />
    </div>
  ) : null

  const editedRepo = access ? repoById(access.repoId) : undefined

  return (
    <RepositoriesStepView
      cards={connectedCards(props.company, repos, inspections, roles, employees)}
      found={found}
      counts={repoCounts(repos, found.counts.offered, found.chosen.length)}
      connectedLabel={connectedLabel(repos)}
      access={
        access
          ? {
              repoId: access.repoId,
              roles: workingRoles(roles).map((role) => ({
                id: role.id,
                name: role.name,
                allowed: access.allowed.has(role.id),
              })),
            }
          : null
      }
      error={panel ? null : error}
      panel={panel}
      uninitialised={uninitialised ?? (emptyPick ? picked : null)}
      onAddAnywhere={() =>
        void (async () => {
          const path = await api().repos.pickFolder()
          if (!path) return
          const started = await api().repos.inspect(path)
          setUninitialised(null)
          // A folder of repos is walked, and they are listed the way Repositories lists them (T278).
          if (started.isGitRepo) await attach([path])
          else setPicked(path)
        })()
      }
      onStartHere={(where) => setUninitialised(where)}
      onInitialised={(path) => {
        setUninitialised(null)
        setPicked(null)
        void run(() => attach([path]))
      }}
      onEditRepo={(id) => {
        setError(null)
        setEditFor(id)
      }}
      onBrief={(id, brief) =>
        void run(async () => {
          const updated = await api().repos.update(id, { brief })
          if (!updated.ok) throw new Error(updated.error)
        })
      }
      onDisconnect={(id) =>
        void run(async () => {
          const removed = await api().repos.remove(id)
          if (!removed.ok) throw new Error(removed.error)
          if (editFor === id) setEditFor(null)
        })
      }
      onChangeAccess={(id) => {
        const repo = repoById(id)
        if (repo) setAccess({ repoId: id, allowed: allowedFor(repo.name) })
      }}
      onToggleRole={(roleId) =>
        setAccess((before) => {
          if (!before) return before
          const allowed = new Set(before.allowed)
          if (!allowed.delete(roleId)) allowed.add(roleId)
          return { ...before, allowed }
        })
      }
      onDoneAccess={() =>
        void run(async () => {
          if (editedRepo && access) await saveAccess(editedRepo.name, access.allowed)
          setAccess(null)
        })
      }
    />
  )
}
