import { Folder, FolderSearch, Info, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AttachScannedResult, Repo, RepoInspection } from '../../../shared/repos/repo'
import { Button, Checkbox, focusOnMount, RepoMarkIcon } from '../ui'
import { InitialiseRepoAlert } from './InitialiseRepo'
import { BriefField } from './RepoAbout'
import {
  BROWSE,
  CONNECTED_PILL,
  FIELD,
  FIELD_HELPER,
  FIELD_LABEL,
  ICON_BUTTON,
  INPUT_BROWSE,
  INPUT_CONTROL_MONO,
  MODAL,
  MODAL_CONTINUE,
  MODAL_FOOTER,
  MODAL_FORM,
  MODAL_HEADER,
  MODAL_OVERLAY,
  MODAL_SUB,
  MODAL_TEXT,
  MODAL_TITLE,
  STEPS,
  STEPS_TEXT,
  TEXT_BUTTON,
} from './repo-classes'
import { attachLabel, initialSelection, type ScanRow, scanRows, selectionLine } from './scan-view-model'

/*
 * Scan a folder's own rows (T210c), styled like the onboarding "Found in" rows
 * (`design/html/onboarding-repositories.html`).
 */
const NOTE = 'm-0 flex items-center gap-8 text-muted-foreground text-12/[normal]'
const NOTE_ERROR = 'm-0 flex items-center gap-8 text-status-error-foreground text-12/[normal]'
const FOUND_LABEL =
  'shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-11/13 font-bold tracking-[0.5px]'
const LIST = 'm-0 flex list-none flex-col gap-10 p-0'
const SCAN_ROW =
  'flex items-center gap-12 rounded-sm border border-border bg-card px-14 py-11 text-foreground [&_svg]:shrink-0'
/* The kit's Choice, with its label off: in a row the box is the whole control. */
const CHECK = 'gap-0 [&_[data-slot=choice-label]]:hidden'
const SCAN_TEXT = 'flex min-w-0 flex-1 flex-col gap-2'
const SCAN_NAME =
  'overflow-hidden text-ellipsis whitespace-nowrap font-code text-heading-ink text-12-5/[normal] font-semibold'
const SCAN_META = 'overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-11/[normal] font-normal'
const ABOUT = 'mt-8 flex flex-col gap-6'
const CHECKS = 'm-0 flex list-none flex-wrap gap-6 p-0'
const CHECK_CHIP =
  'rounded-full border border-border px-8 py-3 whitespace-nowrap font-code text-foreground text-10-5/13'
const CHECK_KEY = 'text-muted-foreground font-semibold'
const SCAN_ERROR = 'text-status-error-foreground text-11/[normal]'
const STATUS_PILL =
  'inline-flex shrink-0 items-center gap-6 rounded-full bg-secondary px-10 py-4 whitespace-nowrap text-soft-ink text-11/13 font-semibold'

const api = window.tinyCorp.repos

export type Scan =
  | { state: 'idle' }
  | { state: 'scanning'; folder: string }
  | { state: 'done'; folder: string; found: RepoInspection[] }
  | { state: 'failed'; folder: string; error: string }

/**
 * Scan a folder: finds the git checkouts under a parent folder (two levels deep) and attaches
 * the selected ones at once, each with the brief typed in its row and its detected checks.
 */
export function ScanFolderModal(props: {
  companyName: string
  repos: Repo[]
  onCancel(): void
  onAttached(result: AttachScannedResult): void
}) {
  const [folder, setFolder] = useState('')
  const [scan, setScan] = useState<Scan>({ state: 'idle' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<AttachScannedResult['failed']>([])
  const [briefs, setBriefs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [rescans, setRescans] = useState(0)

  const found = scan.state === 'done' ? scan.found : null
  const rows = useMemo(() => (found ? scanRows(found, props.repos) : []), [found, props.repos])

  // biome-ignore lint/correctness/useExhaustiveDependencies: rescans only on the folder or a fresh start, per the comment below; `rows` re-marks the rest.
  useEffect(() => {
    const target = folder.trim()
    if (!target) {
      setScan({ state: 'idle' })
      return
    }
    let live = true
    const timer = setTimeout(() => {
      setScan({ state: 'scanning', folder: target })
      void api.scan(target).then((result) => {
        if (!live) return
        if (!result.ok) return setScan({ state: 'failed', folder: target, error: result.error })
        setScan({ state: 'done', folder: target, found: result.value })
        setSelected(initialSelection(scanRows(result.value, props.repos)))
        setFailed([])
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // Rescans only when the folder changes or was initialised; `rows` re-marks repos attached since.
  }, [folder, rescans])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])

  async function browse() {
    const picked = await api.pickScanFolder()
    if (picked) setFolder(picked)
  }

  const chosen = rows.filter((row) => !row.attached && selected.has(row.path)).map((row) => row.path)

  async function attach() {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    try {
      const result = await api.attachScanned(
        chosen,
        Object.fromEntries(chosen.map((path) => [path, briefs[path] ?? ''])),
      )
      if (!result.ok) return setFailed(chosen.map((path) => ({ path, error: result.error })))
      setFailed(result.value.failed)
      setSelected(new Set(result.value.failed.map((failure) => failure.path)))
      props.onAttached(result.value)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (path: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(path)
      else next.delete(path)
      return next
    })

  return createPortal(
    <div className={MODAL_OVERLAY} onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form
        className={MODAL}
        role="dialog"
        aria-modal="true"
        aria-label="Scan a folder"
        onSubmit={(event) => {
          event.preventDefault()
          void attach()
        }}
      >
        <header className={MODAL_HEADER}>
          <div className={MODAL_TEXT}>
            <div className={MODAL_TITLE}>Scan a folder</div>
            <div className={MODAL_SUB}>{props.companyName} · Find git repos and attach several at once</div>
          </div>
          <button type="button" className={ICON_BUTTON} aria-label="Close" onClick={props.onCancel}>
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className={MODAL_FORM}>
          <label className={FIELD}>
            <span className={FIELD_LABEL}>PARENT FOLDER</span>
            <span className={INPUT_BROWSE}>
              <Folder size={14} aria-hidden />
              <input
                className={INPUT_CONTROL_MONO}
                value={folder}
                placeholder="/path/to/projects"
                ref={focusOnMount}
                spellCheck={false}
                onChange={(event) => setFolder(event.target.value)}
              />
              <button type="button" className={BROWSE} onClick={() => void browse()}>
                Browse…
              </button>
            </span>
            <span className={FIELD_HELPER}>Looks two folders deep and skips node_modules and hidden folders.</span>
          </label>

          <ScanResults
            scan={scan}
            rows={rows}
            selected={selected}
            failed={failed}
            onToggle={toggle}
            briefs={briefs}
            onBrief={(path, brief) => setBriefs((current) => ({ ...current, [path]: brief }))}
            onInitialised={() => setRescans((n) => n + 1)}
          />
        </div>

        <footer className={MODAL_FOOTER}>
          <div className={STEPS}>
            <span className={STEPS_TEXT}>{selectionLine(chosen.length, rows)}</span>
          </div>
          <button type="button" className={TEXT_BUTTON} onClick={props.onCancel}>
            Cancel
          </button>
          <Button type="submit" icon={Plus} className={MODAL_CONTINUE} disabled={chosen.length === 0 || busy}>
            {attachLabel(chosen.length)}
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

/** What the scan found: a row per checkout with a checkbox, or why there is nothing to show. */
export function ScanResults(props: {
  scan: Scan
  rows: ScanRow[]
  selected: Set<string>
  failed: AttachScannedResult['failed']
  onToggle(path: string, on: boolean): void
  /** The brief typed for each selected row, by path. */
  briefs?: Record<string, string>
  onBrief?(path: string, brief: string): void
  /** Called once the scanned folder, which held no repos, was made into one. */
  onInitialised?(): void
}) {
  const { scan, rows } = props
  if (scan.state === 'idle') return null
  if (scan.state === 'scanning') return <p className={NOTE}>Scanning {scan.folder}…</p>
  if (scan.state === 'failed') {
    return (
      <p className={NOTE_ERROR} role="alert">
        {scan.error}
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <>
        <p className={NOTE}>
          <FolderSearch size={14} aria-hidden />
          No git repos in {scan.folder} or two folders below it.
        </p>
        {props.onInitialised && <InitialiseRepoAlert path={scan.folder} onInitialised={props.onInitialised} />}
      </>
    )
  }
  const errors = new Map(props.failed.map((failure) => [failure.path, failure.error]))
  return (
    <div className={FIELD}>
      <span className={FOUND_LABEL} title={scan.folder}>
        FOUND IN {scan.folder}
      </span>
      <ul className={LIST} aria-label="Found repositories">
        {rows.map((row) => (
          <li key={row.path} className={SCAN_ROW} data-scan-row>
            <Checkbox
              label=""
              aria-label={`Attach ${row.name}`}
              className={CHECK}
              checked={row.attached || props.selected.has(row.path)}
              disabled={row.attached}
              onChange={(event) => props.onToggle(row.path, event.target.checked)}
            />
            <RepoMarkIcon size={16} aria-hidden />
            <div className={SCAN_TEXT}>
              <div className={SCAN_NAME}>{row.name}</div>
              <div className={SCAN_META} title={row.path}>
                {[row.remote, row.meta].filter(Boolean).join(' · ')}
              </div>
              {!row.attached && props.selected.has(row.path) && (
                <div className={ABOUT}>
                  <BriefField
                    compact
                    label="About this repo"
                    value={props.briefs?.[row.path] ?? ''}
                    onChange={(brief) => props.onBrief?.(row.path, brief)}
                  />
                  {row.checks.length > 0 && (
                    <ul className={CHECKS} aria-label="Checks (optional)">
                      {row.checks.map(({ key, command }) => (
                        <li key={key} className={CHECK_CHIP} title={`${key}: ${command}`}>
                          <span className={CHECK_KEY}>{key}</span> {command}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {errors.has(row.path) && (
                <div className={SCAN_ERROR} role="alert">
                  {errors.get(row.path)}
                </div>
              )}
            </div>
            {row.attached ? (
              <span className={STATUS_PILL}>Attached</span>
            ) : row.checks.length > 0 ? (
              <span className={CONNECTED_PILL}>
                <Sparkles size={12} aria-hidden />
                Checks detected
              </span>
            ) : (
              <span className={STATUS_PILL} title="Employees can work here; whoever sets it up records them">
                <Info size={12} aria-hidden />
                No checks yet
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
