import { FolderInput } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Company } from '../../../shared/company'
import { isTemporaryFolder, TEMPORARY_FOLDER_WARNING, TEMPORARY_ROOTS } from '../../../shared/platform/temporary-folder'
import { Alert, Button, cx } from '../ui'
import '../ui/tailwind.css'

type Movable = Pick<Company, 'id' | 'name' | 'folder'>

/*
 * The alert's body is a row of its own — the error and `Move…` beside each other — in both forms,
 * so it is applied beside the form rather than interpolated into it: Tailwind and
 * `tailwind.test.ts` both read this file as text, and a `${…}` in a class list is a class named
 * `${…}`.
 */
const BODY_ROW =
  '[&_[data-slot=alert-body]]:flex [&_[data-slot=alert-body]]:flex-wrap [&_[data-slot=alert-body]]:items-center [&_[data-slot=alert-body]]:gap-8'

/**
 * Company settings draws the full alert, and it is the only row of `.settings-content`'s wrap that
 * spans it — which is why `basis-full` lives here rather than at the call site: the full form *is*
 * the settings form, and the Launcher's is the compact one below.
 */
const FULL = 'basis-full [&_[data-slot=alert-body]]:mt-8'

/*
 * The Launcher's slim row: the kit's 16px padding and 12px gap close up, the icon comes down from
 * 18 to 14, and the title and `Move…` sit on one line with the body's top margin gone. The sizes
 * carry `/[normal]` because `.ui-alert` sets `line-height: normal` and a bare `text-12` would put
 * the scale's 15px line under text the frame draws on the font's own.
 */
const COMPACT =
  'items-center gap-8 py-6 pr-8 pl-9 text-12/[normal] [&_[data-slot=alert-body]]:mt-0 [&_[data-slot=alert-icon]]:size-14 [&_[data-slot=alert-text]]:flex-1 [&_[data-slot=alert-text]]:flex-row [&_[data-slot=alert-text]]:flex-wrap [&_[data-slot=alert-text]]:items-center [&_[data-slot=alert-text]]:justify-between [&_[data-slot=alert-text]]:gap-8 [&_[data-slot=alert-title]]:text-12/[normal]'

export interface TemporaryFolderWarningProps {
  /** The Launcher row's slim form; Company settings shows the full one. */
  compact?: boolean
  busy?: boolean
  error?: string | null
  onMove(): void
}

/** Decision 45: the Company folder can vanish on restart, with `Move…` to put it somewhere safe. */
export function TemporaryFolderWarning({ compact, busy, error, onMove }: TemporaryFolderWarningProps) {
  return (
    <Alert variant="warning" title={TEMPORARY_FOLDER_WARNING} className={cx(BODY_ROW, compact ? COMPACT : FULL)}>
      {/* 12px on the body's own 20px line, and `basis-full` so it takes the row above `Move…`. */}
      {error && <span className="basis-full text-12/20 text-status-error-foreground">{error}</span>}
      <Button type="button" size="sm" variant="outline" icon={FolderInput} disabled={busy} onClick={onMove}>
        {busy ? 'Moving…' : 'Move…'}
      </Button>
    </Alert>
  )
}

/** The folders a Company should not live in; the fixed ones until the main process adds the OS temp dir. */
export function useTemporaryRoots(): readonly string[] {
  const [roots, setRoots] = useState<readonly string[]>(TEMPORARY_ROOTS)
  useEffect(() => {
    let live = true
    void window.tinyCorp.company.temporaryRoots().then((value) => {
      if (live) setRoots(value)
    })
    return () => {
      live = false
    }
  }, [])
  return roots
}

export interface CompanyMove {
  /** Whether `company` lives in a temporary folder. */
  isTemporary(company: Movable): boolean
  /** The Company being moved now, by id. */
  moving: string | null
  /** The last move's failure and the Company it was for. */
  error: { companyId: string; message: string } | null
  move(company: Movable): void
}

/** Move… for any Company the boss can see; the engine announces the reopened Company, `onMoved` runs after. */
export function useCompanyMove(onMoved?: (company: Company) => void): CompanyMove {
  const roots = useTemporaryRoots()
  const [moving, setMoving] = useState<string | null>(null)
  const [error, setError] = useState<CompanyMove['error']>(null)

  const move = useCallback(
    async (company: Movable) => {
      setMoving(company.id)
      try {
        const result = await window.tinyCorp.company.move(company.id)
        setError(result.ok ? null : { companyId: company.id, message: result.error })
        if (result.ok && result.value) onMoved?.(result.value)
      } finally {
        setMoving(null)
      }
    },
    [onMoved],
  )

  return {
    isTemporary: (company) => isTemporaryFolder(company.folder, roots),
    moving,
    error,
    move: (company) => void move(company),
  }
}
