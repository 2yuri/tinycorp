import { EMPTY_STACK, type Repo, type RepoInspection } from '../../../shared/repos/repo'
import { type CommandKey, historyLine, stackCommands } from './repo-view-model'

/** One checkout found by Scan a folder, as its row shows it. */
export interface ScanRow {
  path: string
  name: string
  /** The `origin` as it is shown, host and path, or `No origin remote`. */
  remote: string
  /** `TypeScript · React · pnpm · 2,104 commits · last push 2d ago`; empty when nothing is known. */
  meta: string
  /** The Checks detection found, attached with the repo; empty is fine ("No checks yet"). */
  checks: { key: CommandKey; command: string }[]
  /** Already one of the Company's repos: shown, never selectable. */
  attached: boolean
}

export function scanRows(found: RepoInspection[], repos: Repo[], now = Date.now()): ScanRow[] {
  const attached = new Set(repos.map((repo) => repo.path))
  return found.map((inspection) => {
    const stack = { ...EMPTY_STACK, ...inspection.detected }
    return {
      path: inspection.path,
      name:
        inspection.path
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop() ?? inspection.path,
      remote: inspection.remote ?? 'No origin remote',
      meta: [
        stack.language,
        stack.framework,
        stack.packageManager,
        historyLine(inspection.commitCount, inspection.lastCommitAt, now),
      ]
        .filter(Boolean)
        .join(' · '),
      checks: stackCommands(stack),
      attached: attached.has(inspection.path),
    }
  })
}

/** Every row that is not attached yet starts selected. */
export function initialSelection(rows: ScanRow[]): Set<string> {
  return new Set(rows.filter((row) => !row.attached).map((row) => row.path))
}

/** `Attach 3 repos`, `Attach 1 repo`. */
export function attachLabel(count: number): string {
  return count === 0 ? 'Attach' : `Attach ${count} ${count === 1 ? 'repo' : 'repos'}`
}

/** `2 of 3 selected`, `All found repos are attached`, or nothing before a scan finds any. */
export function selectionLine(count: number, rows: ScanRow[]): string {
  const open = rows.filter((row) => !row.attached).length
  if (rows.length === 0) return ''
  return open === 0 ? 'All found repos are attached' : `${count} of ${open} selected`
}
