import type { PullRequestRefusal } from '../code'

/** What happened to a file between the PR's base and its head. */
export type DiffFileStatus = 'added' | 'modified' | 'removed' | 'renamed'

/** One changed file of a PR, as the review screen's file list shows it. */
export interface DiffFile {
  /** The path at the head; for a rename, where the file ended up. */
  path: string
  /** Where a renamed file came from; null otherwise. */
  previousPath: string | null
  status: DiffFileStatus
  additions: number
  deletions: number
  /** True when git gave no text to show, e.g. a binary file. */
  binary: boolean
}

/**
 * The two sides of one changed file, which is what Monaco's diff editor reads (T243): it computes
 * the diff itself, so nothing here carries hunks or lines any more. Read one file at a time, when
 * the boss picks it — the file list arrives first and costs nothing.
 */
export interface FileSides {
  path: string
  /** The whole file as the base has it; empty for a file the change added. */
  original: string
  /** The whole file as the head has it; empty for a file the change removed. */
  modified: string
  /** True when git has no text for it, so the pane says so rather than drawing an empty diff. */
  binary: boolean
}

/** One repo's side of a ticket's review: the PR (when there is one) and its diff. */
export interface RepoDiff {
  repoId: string
  /** The PR's URL, or null when there is none yet (the diff is then the local branch's). */
  url: string | null
  /**
   * Why no PR can ever be opened for this repo — it has no `origin`, or it is on a forge TinyCorp
   * has no adapter for — or null when one can. The panel says so rather than waiting for a PR.
   */
  refusal: PullRequestRefusal | null
  /** The branch the diff is of, and the branch it goes into. */
  head: string
  base: string
  /** Every changed file, with its counts — the list only; a file's two sides are read on demand. */
  files: DiffFile[]
}

/** A comment the boss wrote on one line of a PR, kept in the Company so an Employee can read it. */
export interface ReviewComment {
  id: number
  ticketId: number
  repoId: string
  path: string
  /** The line in the head file the comment hangs under. */
  line: number
  /** `BOSS` or an Employee id. */
  authorId: string
  body: string
  /** The PR comment's URL once the forge posted it; null for a repo that can open no PR, or a failed post. */
  url: string | null
  createdAt: string
}

/** What the renderer sends to write a line comment. */
export interface NewReviewComment {
  ticketId: number
  repoId: string
  path: string
  line: number
  body: string
}

/** `+64 −4`, the counts as the file list and the diff head show them (a real minus sign). */
export function countsLabel(file: Pick<DiffFile, 'additions' | 'deletions'>): string {
  return `+${file.additions} −${file.deletions}`
}
