import { FolderGit2, FolderSearch, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Company } from '../../../shared/company'
import { EVERY_REPO } from '../../../shared/domain/staff'
import {
  EMPTY_STACK,
  type Repo,
  type RepoInspection,
  type RepoRung,
  type StackConstraints,
} from '../../../shared/repos/repo'
import { ViewHeader } from '../chrome'
import { ShutOutWarning } from '../hiring'
import { resources, useIpcResource } from '../ipc'
import { Button, EmptyState } from '../ui'
import { AddRepoModal, type RepoSource } from './AddRepoModal'
import { FoundReposModal } from './FoundReposModal'
import { scanningLine } from './found-repos-model'
import { RepoCard } from './RepoCard'
import { LIST, SPLIT, VIEW } from './repo-classes'
import { accessChanges, accessOf, shutOutEmployees } from './repo-view-model'
import { ScanFolderModal } from './ScanFolderModal'
import { StackPanel } from './StackPanel'
import { useFoundRepos } from './use-found-repos'
import '../ui/tailwind.css'

/*
 * The Repositories view (T210c), off `design/html/repositories.html`. The window sets the line box
 * to the font's own, so the cards under it are drawn on their own measured lines.
 */
/* Top Bar actions: Scan Folder and Add Repo, 12px apart. */
const ACTIONS = 'flex items-center gap-12'
const SCAN = 'px-12 py-8'
const LIST_ERROR = 'm-0 text-status-error-foreground text-12/[normal]'
const EMPTY = 'my-auto w-full max-w-480 self-center'

const api = window.tinyCorp

type Flow =
  | { step: 'source'; source: RepoSource | null }
  | { step: 'stack'; source: RepoSource }
  | { step: 'edit'; repoId: string }
  | { step: 'scan' }
  /** The picked folder holds repos of its own: the whole tree, ticked in one go (T168). */
  | { step: 'found' }

/** The Repositories view: the Company's repos, their briefs and checks, and the Add repository flow. */
export function Repositories(props: { company: Company; repoId?: string | undefined }) {
  const repos = useIpcResource(resources.repos)
  const roles = useIpcResource(resources.roles)
  const employees = useIpcResource(resources.employees)
  const [inspections, setInspections] = useState<Record<string, RepoInspection>>({})
  const [roots, setRoots] = useState<Record<string, string>>({})
  const [flow, setFlow] = useState<Flow | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // What the checkouts on disk say, read again whenever the repos themselves change.
  const refreshInspections = useCallback(async (list: Repo[]) => {
    const worktreeRoots = await api.repos.worktreeRoots()
    if (worktreeRoots.ok) setRoots(worktreeRoots.value)
    const found = await Promise.all(list.map((repo) => api.repos.inspect(repo.path)))
    setInspections(Object.fromEntries(list.map((repo, i) => [repo.id, found[i]!])))
  }, [])

  useEffect(() => {
    void refreshInspections(repos)
  }, [repos, refreshInspections])

  const closeFlow = () => {
    setFlow(null)
    setFolder(null)
    setError(null)
  }

  // The folder the boss pointed Add repository at is walked beside the step it is typed in, so the
  // moment it turns out to hold repos of its own the flow can hand over with the rows already in.
  const onSource = flow?.step === 'source'
  const found = useFoundRepos(onSource || flow?.step === 'found' ? folder : null, repos)
  const holdsRepos = found.rows.some((row) => row.where !== '')
  // Read while rendering rather than written back into the flow: the rows are in before the modal
  // that shows them is, so the hand-over is one frame and not two (T211).
  const showFound = flow?.step === 'found' || (onSource && holdsRepos)

  /** Writes the role chips into the roles' repo filters; the engine carries them on to the roles' Employees. */
  async function saveAccess(repoName: string, allowed: Set<string>, all: Repo[]) {
    for (const role of accessChanges(repoName, allowed, all, roles)) {
      const result = await api.staff.updateRole(role.id, { repoFilter: role.repoFilter })
      if (!result.ok) throw new Error(result.error)
    }
  }

  async function save({
    brief,
    stack,
    allowed,
    rung,
  }: {
    brief: string
    stack: StackConstraints
    allowed: Set<string>
    rung: RepoRung
  }) {
    if (!flow || flow.step === 'source' || flow.step === 'scan' || flow.step === 'found') return
    setBusy(true)
    try {
      if (flow.step === 'stack') {
        const { path, name } = flow.source
        const added = await api.repos.add({ path, name, brief, stack, rung })
        if (!added.ok) throw new Error(added.error)
        await saveAccess(added.value.name, allowed, [...repos, added.value])
      } else {
        const repo = repos.find((r) => r.id === flow.repoId)
        if (!repo) throw new Error('This repository was removed')
        const updated = await api.repos.update(repo.id, { brief, stack, rung })
        if (!updated.ok) throw new Error(updated.error)
        await saveAccess(repo.name, allowed, repos)
      }
      closeFlow()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  /** The `…` menu moving one repo up or down the ladder, with nothing else touched. */
  async function setRung(repo: Repo, rung: RepoRung) {
    const result = await api.repos.update(repo.id, { rung })
    setError(result.ok ? null : result.error)
  }

  async function remove(repo: Repo) {
    const result = await api.repos.remove(repo.id)
    setError(result.ok ? null : result.error)
  }

  const allowedFor = (repoName: string) => new Set(accessOf(repoName, roles, employees).roles.map((role) => role.id))

  /**
   * Who these repos let nobody near (T239). This is the screen that decides repo access, so it is
   * the screen that has to say when an Employee's filter matches none of what is on it.
   */
  const shutOut = shutOutEmployees(repos, employees)

  async function allowAllRepos(employeeId: string) {
    const result = await api.staff.updateEmployee(employeeId, { repoFilter: EVERY_REPO })
    setError(result.ok ? null : result.error)
  }

  let panel = null
  if (flow?.step === 'stack') {
    const { source } = flow
    panel = (
      <StackPanel
        key={`add:${source.path}`}
        mode="add"
        name={source.name}
        path={source.path}
        inspection={source.inspection}
        initialBrief=""
        initialStack={{ ...EMPTY_STACK, ...(source.detect ? source.inspection.detected : {}) }}
        roles={roles}
        initialAllowed={allowedFor(source.name)}
        error={error}
        busy={busy}
        onCancel={closeFlow}
        onSave={(values) => void save(values)}
      />
    )
  } else if (flow?.step === 'edit') {
    const repo = repos.find((r) => r.id === flow.repoId)
    if (repo) {
      panel = (
        <StackPanel
          key={`edit:${repo.id}`}
          mode="edit"
          name={repo.name}
          path={repo.path}
          inspection={inspections[repo.id] ?? null}
          initialBrief={repo.brief}
          initialStack={repo.stack}
          initialRung={repo.rung}
          roles={roles}
          initialAllowed={allowedFor(repo.name)}
          error={error}
          busy={busy}
          onCancel={closeFlow}
          onSave={(values) => void save(values)}
        />
      )
    }
  }

  return (
    <div className={VIEW}>
      <ViewHeader
        title="Repositories"
        subtitle="Employees only work inside repos you connect here — describe each one so they know what it is."
      >
        <div className={ACTIONS}>
          <Button
            variant="ghost"
            size="toolbar"
            icon={FolderSearch}
            className={SCAN}
            onClick={() => {
              setError(null)
              setFlow({ step: 'scan' })
            }}
          >
            Scan a folder
          </Button>
          <Button icon={Plus} onClick={() => setFlow({ step: 'source', source: null })}>
            Add repository
          </Button>
        </div>
      </ViewHeader>

      <div className={SPLIT}>
        <div className={LIST}>
          {error && !panel && (
            <p className={LIST_ERROR} role="alert">
              {error}
            </p>
          )}
          {shutOut.map((employee) => (
            <ShutOutWarning key={employee.id} who={employee.name} onAllowAll={() => void allowAllRepos(employee.id)} />
          ))}
          {repos.length === 0 ? (
            <EmptyState
              className={EMPTY}
              icon={FolderGit2}
              title="No repositories yet"
              body="Connect a git checkout and describe it. Employees only work inside repos listed here."
              action={
                <Button icon={Plus} onClick={() => setFlow({ step: 'source', source: null })}>
                  Add repository
                </Button>
              }
            />
          ) : (
            repos.map((repo) => (
              <RepoCard
                key={repo.id}
                repo={repo}
                inspection={inspections[repo.id]}
                worktreeRoot={roots[repo.id]}
                roles={roles}
                employees={employees}
                highlighted={props.repoId === repo.id}
                onEdit={() => {
                  setError(null)
                  setFlow({ step: 'edit', repoId: repo.id })
                }}
                onRemove={() => void remove(repo)}
                onRung={(rung) => void setRung(repo, rung)}
              />
            ))
          )}
        </div>
        {panel}
      </div>

      {flow?.step === 'scan' && (
        <ScanFolderModal
          companyName={props.company.name}
          repos={repos}
          onCancel={closeFlow}
          onAttached={(result) => result.failed.length === 0 && closeFlow()}
        />
      )}

      {flow?.step === 'source' && !showFound && (
        <AddRepoModal
          companyName={props.company.name}
          initial={flow.source}
          onFolder={setFolder}
          scanNote={found.scanning ? scanningLine(found.total) : null}
          onCancel={closeFlow}
          onContinue={(source) => {
            setError(null)
            setFlow({ step: 'stack', source })
          }}
        />
      )}

      {showFound && folder && (
        <FoundReposModal
          folder={folder}
          state={found}
          onCancel={closeFlow}
          onChangeFolder={async () => {
            const picked = await api.repos.pickScanFolder()
            if (picked) setFolder(picked)
            return picked
          }}
          onStartHere={(where) => {
            setFolder(null)
            setFlow({ step: 'source', source: null })
            void api.repos.inspect(where).then((inspection) =>
              setFlow({
                step: 'source',
                source: { path: where, name: nameOf(where), inspection, detect: true },
              }),
            )
          }}
          onAdded={(result) => result.failed.length === 0 && closeFlow()}
        />
      )}
    </div>
  )
}

/** The last segment of a folder path, which is the name a repo takes by default. */
function nameOf(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? path
  )
}
