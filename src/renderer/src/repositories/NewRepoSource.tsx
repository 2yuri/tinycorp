import { CircleAlert, Folder, FolderInput, FolderPlus, GitBranch, Laptop, type LucideIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RemoteOffer, RepoInspection, RepoStartPlan } from '../../../shared/repos/repo'
import { machineWordsHere } from '../chrome'
import { cx, focusOnMount, Toggle } from '../ui'
import { newRepoPath, type PlanLine, type PlanTone, planLine, remoteLine, repoNameProblem } from './new-repo-view-model'
import '../ui/tailwind.css'
import {
  BROWSE,
  DETECT,
  DETECT_SUB,
  DETECT_TEXT,
  DETECT_TITLE,
  DETECT_TOGGLE,
  DIVIDER,
  FIELD,
  FIELD_GROW,
  FIELD_LABEL,
  INPUT_BROWSE,
  INPUT_CONTROL_MONO,
  INPUT_TALL,
  NEW_REPO_ERROR,
  PLAN_BADGE,
  PLAN_BADGE_IN_PLACE,
  PLAN_BADGE_LOCAL,
  PLAN_BADGE_REFUSED,
  PLAN_DETECT_OFF,
  PLAN_REFUSED,
  PLAN_SUB,
  PLAN_SUB_REFUSED,
  REMOTE,
  REMOTE_TEXT,
  REMOTE_URL,
  ROW,
} from './repo-classes'

const badgeTone: Record<string, string> = {
  local: PLAN_BADGE_LOCAL,
  'in-place': PLAN_BADGE_IN_PLACE,
  refused: PLAN_BADGE_REFUSED,
}

const api = () => window.tinyCorp.repos

/** A repo started from the panel, ready for step 2. */
export interface StartedRepo {
  path: string
  name: string
  inspection: RepoInspection
}

export interface NewRepoState {
  location: string
  setLocation(location: string): void
  name: string
  setName(name: string): void
  browse(): Promise<void>
  /** The folder the repo starts in, once a location and a valid name are given. */
  path: string | null
  line: PlanLine | null
  offer: RemoteOffer | null
  withRemote: boolean
  setWithRemote(on: boolean): void
  /** Set once the repo exists on disk: the fields lock, and Continue goes on without starting it again. */
  started: StartedRepo | null
  canStart: boolean
  /** What is happening right now, as the button says it; null when idle. */
  busy: string | null
  error: string | null
  /** Starts the repo, then creates its remote when asked; answers it, or null when something failed. */
  start(): Promise<StartedRepo | null>
}

/** The New repository source's state (T144). `active` is whether the source is the one chosen. */
export function useNewRepo(active: boolean): NewRepoState {
  const [location, setLocation] = useState('')
  const [name, setName] = useState('')
  const [plan, setPlan] = useState<RepoStartPlan | null>(null)
  const [offers, setOffers] = useState<RemoteOffer[] | null>(null)
  const [withRemote, setWithRemote] = useState(false)
  const [started, setStarted] = useState<StartedRepo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const path = newRepoPath(location, name)

  useEffect(() => {
    if (!active || offers !== null) return
    void api()
      .remoteOffers()
      .then((result) => setOffers(result.ok ? result.value : []))
  }, [active, offers])

  useEffect(() => {
    if (!active || !path || started) return
    let live = true
    const timer = setTimeout(() => {
      void api()
        .planStart(path)
        .then((found) => live && setPlan(found))
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [active, path, started])

  const nameProblem = name.trim() ? repoNameProblem(name) : null
  const line: PlanLine | null = started
    ? null
    : nameProblem && location.trim()
      ? {
          path: `${location.trim().replace(/\/+$/, '')}/${name.trim()}`,
          sub: nameProblem,
          badge: 'Can’t start here',
          tone: 'refused',
          startable: false,
        }
      : plan && plan.path === path
        ? planLine(plan)
        : null
  const offer = offers?.find((candidate) => candidate.ready) ?? offers?.[0] ?? null
  const remoteWanted = withRemote && offer !== null && !started?.inspection.remote

  async function start(): Promise<StartedRepo | null> {
    if (busy) return null
    let repo = started
    try {
      if (!repo) {
        if (!path || !line?.startable) return null
        setBusy('Creating…')
        const result = await api().initialise(path)
        if (!result.ok) {
          setError(result.error)
          return null
        }
        repo = { path, name: name.trim(), inspection: result.value }
        setStarted(repo)
      }
      if (remoteWanted && offer) {
        setBusy(`Creating on ${offer.name}…`)
        const result = await api().createRemote(repo.path, {
          forge: offer.forge,
          name: repo.name,
          visibility: 'private',
        })
        if (!result.ok) {
          setError(
            `${result.error}. The repo is started on ${machineWordsHere().machine}: turn this off to go on without a remote.`,
          )
          return null
        }
        repo = { ...repo, inspection: result.value }
        setStarted(repo)
      }
      setError(null)
      return repo
    } finally {
      setBusy(null)
    }
  }

  return {
    location,
    setLocation,
    name,
    setName,
    async browse() {
      const folder = await api().pickFolder()
      if (folder) setLocation(folder)
    },
    path,
    line,
    offer,
    withRemote,
    setWithRemote,
    started,
    canStart:
      busy === null && (started !== null || line?.startable === true) && (!remoteWanted || offer?.ready === true),
    busy,
    error,
    start,
  }
}

const toneIcon: Record<PlanTone, LucideIcon> = { local: FolderPlus, 'in-place': FolderInput, refused: CircleAlert }
const badgeIcon: Record<PlanTone, LucideIcon> = { local: Laptop, 'in-place': FolderInput, refused: X }

/** Location, what starting there does, the name, and the optional remote (frame `gFdvh`). */
export function NewRepoFields({ state }: { state: NewRepoState }) {
  const locked = state.started !== null
  const remote = state.offer ? remoteLine(state.offer) : null
  return (
    <>
      <label className={FIELD} data-field>
        <span className={FIELD_LABEL}>LOCATION</span>
        <span className={INPUT_BROWSE}>
          <Folder size={14} aria-hidden />
          <input
            className={INPUT_CONTROL_MONO}
            value={state.location}
            placeholder="/path/to/code"
            ref={focusOnMount}
            spellCheck={false}
            disabled={locked}
            onChange={(event) => state.setLocation(event.target.value)}
          />
          <button type="button" className={BROWSE} disabled={locked} onClick={() => void state.browse()}>
            Browse…
          </button>
        </span>
      </label>

      {state.started ? (
        <StartRow
          icon={GitBranch}
          path={state.started.path}
          sub={
            state.started.inspection.remote
              ? `origin ${state.started.inspection.remote}`
              : 'Started · one first commit on main'
          }
          badge={state.started.inspection.remote ? 'Connected' : 'Local only'}
          tone="local"
        />
      ) : (
        state.line && (
          <StartRow
            icon={toneIcon[state.line.tone]}
            path={state.line.path}
            sub={state.line.sub}
            badge={state.line.badge}
            tone={state.line.tone}
          />
        )
      )}

      <div className={ROW}>
        <label className={FIELD_GROW} data-field>
          <span className={FIELD_LABEL}>REPOSITORY NAME</span>
          <span className={INPUT_TALL}>
            <input
              className={INPUT_CONTROL_MONO}
              value={state.name}
              placeholder="payments-web"
              spellCheck={false}
              disabled={locked}
              onChange={(event) => state.setName(event.target.value)}
            />
          </span>
        </label>
        <div className={FIELD_GROW}>
          <span className={FIELD_LABEL}>DEFAULT BRANCH</span>
          <span className={INPUT_TALL} aria-disabled title="A new repo starts on main">
            <GitBranch size={14} aria-hidden />
            <span className={INPUT_CONTROL_MONO}>main</span>
          </span>
        </div>
      </div>

      {remote && state.offer && (
        <>
          <div className={DIVIDER} />
          <div className={state.offer.ready ? DETECT : PLAN_DETECT_OFF}>
            <div className={DETECT_TEXT}>
              <div className={DETECT_TITLE} data-detect-title>
                {remote.title}
              </div>
              <div className={DETECT_SUB}>{remote.sub}</div>
            </div>
            <Toggle
              label=""
              aria-label={remote.title}
              className={DETECT_TOGGLE}
              data-detect-toggle
              checked={state.withRemote && state.offer.ready}
              disabled={!state.offer.ready || Boolean(state.started?.inspection.remote) || state.busy !== null}
              onChange={(event) => state.setWithRemote(event.target.checked)}
            />
          </div>
        </>
      )}

      {state.error && (
        <div className={NEW_REPO_ERROR} role="alert">
          {state.error}
        </div>
      )}
    </>
  )
}

function StartRow(props: { icon: LucideIcon; path: string; sub: string; badge: string; tone: PlanTone }) {
  const Icon = props.icon
  const BadgeIcon = badgeIcon[props.tone]
  return (
    <div className={props.tone === 'refused' ? PLAN_REFUSED : REMOTE} data-testid="new-repo-plan">
      <Icon size={16} aria-hidden />
      <div className={REMOTE_TEXT}>
        <div className={REMOTE_URL}>{props.path}</div>
        <div className={props.tone === 'refused' ? PLAN_SUB_REFUSED : PLAN_SUB}>{props.sub}</div>
      </div>
      <span className={cx(PLAN_BADGE, badgeTone[props.tone])}>
        <BadgeIcon size={12} aria-hidden />
        {props.badge}
      </span>
    </div>
  )
}
