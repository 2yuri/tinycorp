import {
  ArrowRight,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitBranchPlus,
  Link,
  type LucideIcon,
  X,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_FORGE, FORGE_LABEL } from '../../../shared/forges'
import type { RepoInspection } from '../../../shared/repos/repo'
import { machineWordsHere } from '../chrome'
import { Button, focusOnMount, RepoMarkIcon, Toggle } from '../ui'
import { InitialiseRepoAlert } from './InitialiseRepo'
import { NewRepoFields, useNewRepo } from './NewRepoSource'
import {
  BROWSE,
  CHOICE_INPUT,
  CONNECTED_PILL,
  DETECT,
  DETECT_SUB,
  DETECT_TEXT,
  DETECT_TITLE,
  DETECT_TOGGLE,
  DIVIDER,
  FIELD,
  FIELD_GROW,
  FIELD_HELPER,
  FIELD_LABEL,
  ICON_BUTTON,
  INPUT_BROWSE,
  INPUT_CONTROL_MONO,
  INPUT_TALL,
  MODAL,
  MODAL_CONTINUE,
  MODAL_FOOTER,
  MODAL_FORM,
  MODAL_HEADER,
  MODAL_OVERLAY,
  MODAL_SUB,
  MODAL_TEXT,
  MODAL_TITLE,
  REMOTE,
  REMOTE_SUB,
  REMOTE_SUB_COMPACT,
  REMOTE_TEXT,
  REMOTE_URL,
  ROW,
  SOURCE,
  SOURCE_SELECTED,
  SOURCE_SUB,
  SOURCE_TITLE,
  SOURCES,
  STEPS,
  STEPS_DOT,
  STEPS_DOT_ACTIVE,
  STEPS_TEXT,
  TEXT_BUTTON,
} from './repo-classes'
import { historyLine } from './repo-view-model'

/** What step 1 hands to step 2. */
export interface RepoSource {
  path: string
  name: string
  inspection: RepoInspection
  detect: boolean
}

const api = () => window.tinyCorp.repos

type SourceKind = 'local' | 'new'

/**
 * Add repository, step 1 of 2: where the repo comes from — a folder already on this Mac (frame
 * `n7zRW0`), or a new repo started here (frame `gFdvh`, T144). Cloning is not supported yet.
 */
export function AddRepoModal(props: {
  companyName: string
  initial: RepoSource | null
  onCancel(): void
  onContinue(source: RepoSource): void
  /**
   * The folder the boss is pointing at, as it settles. A walk of it runs beside this step, and the
   * flow hands over to the Found repositories picker the moment it turns out to hold repos of its
   * own (T168); a folder that holds none never interrupts what the boss was doing.
   */
  onFolder?(folder: string | null): void
  /** `Scanning… 84 found` while that walk runs, under the path field. */
  scanNote?: string | null
}) {
  const [kind, setKind] = useState<SourceKind>('local')
  const sourceName = useId()
  const [path, setPath] = useState(props.initial?.path ?? '')
  const [name, setName] = useState(props.initial?.name ?? '')
  const [nameEdited, setNameEdited] = useState(props.initial !== null)
  const [detect, setDetect] = useState(props.initial?.detect ?? true)
  const [inspection, setInspection] = useState<RepoInspection | null>(props.initial?.inspection ?? null)

  const { onFolder } = props
  useEffect(() => {
    const folder = path.trim()
    if (!folder) {
      setInspection(null)
      onFolder?.(null)
      return
    }
    let live = true
    const timer = setTimeout(() => {
      onFolder?.(folder)
      void api()
        .inspect(folder)
        .then((found) => live && setInspection(found))
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [path, onFolder])

  useEffect(() => {
    if (nameEdited) return
    setName(
      path
        .trim()
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? '',
    )
  }, [path, nameEdited])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])

  async function browse() {
    const folder = await api().pickFolder()
    if (folder) setPath(folder)
  }

  const current = inspection?.path === path.trim() ? inspection : null
  const canContinue = current?.isGitRepo === true && name.trim() !== ''
  const newRepo = useNewRepo(kind === 'new')

  return createPortal(
    <div className={MODAL_OVERLAY} onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form
        className={MODAL}
        role="dialog"
        aria-modal="true"
        aria-label="Add repository"
        onSubmit={(event) => {
          event.preventDefault()
          if (kind === 'new') {
            void newRepo.start().then((started) => started && props.onContinue({ ...started, detect }))
            return
          }
          if (current && canContinue)
            props.onContinue({ path: path.trim(), name: name.trim(), inspection: current, detect })
        }}
      >
        <header className={MODAL_HEADER}>
          <div className={MODAL_TEXT}>
            <div className={MODAL_TITLE}>Add repository</div>
            <div className={MODAL_SUB}>{props.companyName} · Step 1 of 2 · Source</div>
          </div>
          <button type="button" className={ICON_BUTTON} aria-label="Close" onClick={props.onCancel}>
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className={MODAL_FORM}>
          <div className={FIELD}>
            <span className={FIELD_LABEL}>SOURCE</span>
            <div className={SOURCES} role="radiogroup" aria-label="Source">
              <Source
                icon={FolderOpen}
                title="Local folder"
                sub={`Already on ${machineWordsHere().machine}`}
                name={sourceName}
                selected={kind === 'local'}
                onSelect={() => setKind('local')}
              />
              <Source
                icon={FolderPlus}
                title="New repository"
                sub="Start one here, empty"
                name={sourceName}
                selected={kind === 'new'}
                onSelect={() => setKind('new')}
              />
              <Source
                icon={RepoMarkIcon}
                title={`Clone from ${FORGE_LABEL[DEFAULT_FORGE]}`}
                sub="Not available yet"
                name={sourceName}
              />
              <Source icon={Link} title="Remote URL" sub="Not available yet" name={sourceName} />
            </div>
          </div>

          {kind === 'new' ? (
            <NewRepoFields state={newRepo} />
          ) : (
            <>
              <label className={FIELD} data-field>
                <span className={FIELD_LABEL}>LOCAL PATH</span>
                <span className={INPUT_BROWSE}>
                  <Folder size={14} aria-hidden />
                  <input
                    className={INPUT_CONTROL_MONO}
                    value={path}
                    placeholder="/path/to/repo"
                    ref={focusOnMount}
                    spellCheck={false}
                    onChange={(event) => setPath(event.target.value)}
                  />
                  <button type="button" className={BROWSE} onClick={() => void browse()}>
                    Browse…
                  </button>
                </span>
                {props.scanNote && <span className={FIELD_HELPER}>{props.scanNote}</span>}
              </label>

              {current && !current.isGitRepo ? (
                <InitialiseRepoAlert
                  path={current.path}
                  onInitialised={(found) => setInspection({ ...found, path: current.path })}
                />
              ) : (
                <DetectedRemote inspection={current} path={path.trim()} />
              )}

              <div className={ROW}>
                <label className={FIELD_GROW} data-field>
                  <span className={FIELD_LABEL}>DISPLAY NAME</span>
                  <span className={INPUT_TALL}>
                    <input
                      className={INPUT_CONTROL_MONO}
                      value={name}
                      spellCheck={false}
                      onChange={(event) => {
                        setNameEdited(true)
                        setName(event.target.value)
                      }}
                    />
                  </span>
                </label>
                <div className={FIELD_GROW}>
                  <span className={FIELD_LABEL}>DEFAULT BRANCH</span>
                  <span className={INPUT_TALL} aria-disabled title="Read from origin">
                    <GitBranch size={14} aria-hidden />
                    <span className={INPUT_CONTROL_MONO}>{current?.defaultBranch ?? '—'}</span>
                    <ChevronDown size={14} aria-hidden />
                  </span>
                </div>
              </div>
            </>
          )}

          <div className={DIVIDER} />

          <div className={DETECT}>
            <div className={DETECT_TEXT}>
              <div className={DETECT_TITLE}>Detect the stack automatically</div>
              <div className={DETECT_SUB}>
                Reads package.json, lockfiles and CI config to prefill install, build, test and lint in step 2.
              </div>
            </div>
            <Toggle
              label=""
              aria-label="Detect the stack automatically"
              className={DETECT_TOGGLE}
              checked={detect}
              onChange={(event) => setDetect(event.target.checked)}
            />
          </div>
        </div>

        <footer className={MODAL_FOOTER}>
          <div className={STEPS}>
            <span className={STEPS_DOT_ACTIVE} aria-hidden />
            <span className={STEPS_DOT} aria-hidden />
            <span className={STEPS_TEXT}>Source</span>
          </div>
          <button type="button" className={TEXT_BUTTON} onClick={props.onCancel}>
            Cancel
          </button>
          {kind === 'new' ? (
            <Button
              type="submit"
              icon={newRepo.started ? ArrowRight : GitBranchPlus}
              className={MODAL_CONTINUE}
              disabled={!newRepo.canStart}
            >
              {newRepo.busy ? newRepo.busy : newRepo.started ? 'Continue' : 'Create repository'}
            </Button>
          ) : (
            <Button type="submit" icon={ArrowRight} className={MODAL_CONTINUE} disabled={!canContinue}>
              Continue
            </Button>
          )}
        </footer>
      </form>
    </div>,
    document.body,
  )
}

function Source(props: {
  icon: LucideIcon | typeof RepoMarkIcon
  title: string
  sub: string
  selected?: boolean
  /** The radio group this card is one of. */
  name: string
  /** Left out, the source is not available yet. */
  onSelect?(): void
}) {
  const Icon = props.icon
  const onSelect = props.onSelect
  return (
    <label
      title={onSelect ? undefined : 'Not available yet'}
      className={props.selected ? SOURCE_SELECTED : SOURCE}
      data-source
    >
      <input
        type="radio"
        className={CHOICE_INPUT}
        name={props.name}
        disabled={!onSelect}
        checked={props.selected === true}
        onChange={() => onSelect?.()}
      />
      <Icon size={16} aria-hidden />
      <span className={SOURCE_TITLE}>{props.title}</span>
      <span className={SOURCE_SUB}>{props.sub}</span>
    </label>
  )
}

/** The origin read from the folder, or why there is none. */
export function DetectedRemote(props: { inspection: RepoInspection | null; path: string; compact?: boolean }) {
  const { inspection } = props
  if (!props.path) return null
  const notGit = inspection !== null && !inspection.isGitRepo
  const title =
    inspection === null ? 'Reading the folder…' : notGit ? 'Not a git repo' : (inspection.remote ?? 'No origin remote')
  const sub = !inspection
    ? ' '
    : notGit
      ? 'Choose the folder of a git checkout.'
      : props.compact
        ? ['Read from origin', inspection.defaultBranch && `default branch ${inspection.defaultBranch}`]
            .filter(Boolean)
            .join(' · ')
        : ['Read from origin', historyLine(inspection.commitCount, inspection.lastCommitAt)].filter(Boolean).join(' · ')
  return (
    <div className={REMOTE}>
      <RepoMarkIcon size={16} aria-hidden />
      <div className={REMOTE_TEXT}>
        <div className={REMOTE_URL}>{title}</div>
        <div className={props.compact ? REMOTE_SUB_COMPACT : REMOTE_SUB}>{sub}</div>
      </div>
      {!props.compact && inspection?.remote && (
        <span className={CONNECTED_PILL}>
          <Check size={12} aria-hidden />
          Connected
        </span>
      )}
    </div>
  )
}
