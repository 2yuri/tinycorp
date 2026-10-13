import { FolderSearch, Info, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AttachScannedResult } from '../../../shared/repos/repo'
import { tildePath } from '../paths'
import { Button } from '../ui'
import { FoundReposPicker } from './FoundRepos'
import { addLabel, foundSummary, scanningLine } from './found-repos-model'
import {
  ICON_BUTTON,
  MODAL_CONTINUE,
  MODAL_FOOTER,
  MODAL_FORM_FOUND,
  MODAL_FOUND,
  MODAL_HEADER,
  MODAL_OVERLAY,
  MODAL_SUB,
  MODAL_TEXT,
  TEXT_BUTTON,
} from './repo-classes'
import type { FoundRepos } from './use-found-repos'

/*
 * The modal the found-repositories picker sits in (frame `UohF8`, T210c). Its header names the
 * folder rather than the step, so the title is a path and wears the mono face.
 */
const HEADER_TILE =
  'flex h-38 w-38 shrink-0 items-center justify-center rounded-sm border border-border bg-secondary text-soft-ink'
const HEADER_FOLDER = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-foreground text-16/19 font-bold'
const CHANGE =
  'm-0 shrink-0 cursor-pointer rounded-sm border border-border bg-secondary px-12 py-7 font-sans text-foreground text-12-5/[normal] font-medium hover:border-ring'
const FAILURES = 'm-0 flex list-none flex-col gap-4 p-0 text-destructive text-11-5/[normal]'
const WHERE = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-muted-foreground text-11/[normal]'
const FOOTER_NOTE = 'm-0 flex flex-1 items-center gap-8 text-muted-foreground text-11-5/[normal]'

const api = () => window.tinyCorp.repos

/**
 * The repositories found inside a picked folder, all of them, ticked in one go (frame `UohF8`).
 * Add Repository hands over to this the moment the folder the boss picked turns out to hold repos
 * of its own: dozens of checkouts in nested folders is what a real Mac looks like, and adding them
 * one modal at a time is not a thing anyone would do (T168).
 */
export function FoundReposModal(props: {
  folder: string
  /** The walk, started where the boss picked the folder, so nothing is read twice. */
  state: FoundRepos
  onCancel(): void
  /** Picks another folder; resolves to null when the boss cancels the picker. */
  onChangeFolder(): Promise<string | null>
  /** An empty folder sends the boss to New repository with this folder filled in. */
  onStartHere(folder: string): void
  onAdded(result: AttachScannedResult): void
}) {
  const { folder, state } = props
  const [failed, setFailed] = useState<AttachScannedResult['failed']>([])
  const [busy, setBusy] = useState(false)
  const { counts, chosen } = state

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && props.onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [props])

  async function changeFolder() {
    if (await props.onChangeFolder()) setFailed([])
  }

  async function add() {
    if (chosen.length === 0 || busy) return
    setBusy(true)
    try {
      const result = await api().attachScanned(chosen)
      if (!result.ok) return setFailed(chosen.map((path) => ({ path, error: result.error })))
      setFailed(result.value.failed)
      props.onAdded(result.value)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className={MODAL_OVERLAY} onPointerDown={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form
        className={MODAL_FOUND}
        role="dialog"
        aria-modal="true"
        aria-label="Found repositories"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <header className={MODAL_HEADER}>
          <span className={HEADER_TILE}>
            <FolderSearch size={18} aria-hidden />
          </span>
          <div className={MODAL_TEXT}>
            <div className={HEADER_FOLDER} title={folder}>
              {tildePath(folder)}
            </div>
            <div className={MODAL_SUB}>{state.scanning ? scanningLine(state.total) : foundSummary(counts)}</div>
          </div>
          <button type="button" className={CHANGE} onClick={() => void changeFolder()}>
            Change folder…
          </button>
          <button type="button" className={ICON_BUTTON} aria-label="Close" onClick={props.onCancel}>
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className={MODAL_FORM_FOUND}>
          <FoundReposPicker
            inModal
            state={state}
            onChangeFolder={() => void changeFolder()}
            onStartHere={props.onStartHere}
          />
          {failed.length > 0 && (
            <ul className={FAILURES} aria-label="Repositories that could not be added">
              {failed.map((failure) => (
                <li key={failure.path} role="alert">
                  <span className={WHERE}>{tildePath(failure.path)}</span> {failure.error}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className={MODAL_FOOTER}>
          <p className={FOOTER_NOTE}>
            <Info size={13} aria-hidden />
            Each one becomes a repository of this Company, with its own brief.
          </p>
          <button type="button" className={TEXT_BUTTON} onClick={props.onCancel}>
            Cancel
          </button>
          <Button type="submit" icon={Plus} className={MODAL_CONTINUE} disabled={chosen.length === 0 || busy}>
            {addLabel(chosen.length)}
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}
