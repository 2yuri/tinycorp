/** How long a Company keeps a restore point, in days. Past that it is dropped. */
export const RETENTION_DAYS = 7

/** Why a restore point was taken. */
export type RestorePointReason = 'start' | 'commit' | 'going-back' | 'discard' | 'sub-session'

/**
 * A point in an Employee's work on one ticket worktree: the commit it was at and whatever was
 * uncommitted. The uncommitted work is kept where the Company's data lives, never in the repo
 * (decision 45).
 */
export interface RestorePoint {
  id: string
  ticketId: number
  repoId: string
  /** Who was working when it was taken, or null when nobody held the ticket. */
  employeeId: string | null
  reason: RestorePointReason
  /** What the Employee said it was doing: its commit's subject, or why the point was taken. */
  note: string
  /** The commit the worktree was at. */
  commit: string
  branch: string
  /** Whether anything was uncommitted when it was taken. */
  hadUncommitted: boolean
  takenAt: string
}

/** What going back to a restore point throws away. */
export interface RestoreLoss {
  /** The subjects of the commits made after the point, newest first. */
  commits: string[]
  /** Whether the worktree has uncommitted work right now. */
  uncommitted: boolean
  /** Who is working on the ticket and stops first, or null when nobody is. */
  stops: { employeeId: string; name: string } | null
}

/** The commit as the drawer shows it. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7)
}
