import { clockTime } from '../../../shared/platform/clock-time'
import {
  type RestoreLoss,
  type RestorePoint,
  type RestorePointReason,
  shortCommit,
} from '../../../shared/restore-points'

/** What each kind of point says it is, in the drawer's list. */
export const REASON_LABEL: Record<RestorePointReason, string> = {
  start: 'Before the work started',
  commit: 'Committed',
  'going-back': 'Before going back',
  discard: 'Before a discard',
  'sub-session': 'Before a sub-session’s worktree was removed',
}

/** The section's own line, so the boss knows the list does not grow forever. */
export function retentionNote(days: number): string {
  return `Kept for ${days} day${days === 1 ? '' : 's'}, and dropped when the ticket is done.`
}

/** The confirmation's title, naming what the Employee said it was doing. */
export function goBackTitle(point: Pick<RestorePoint, 'note' | 'reason'>): string {
  return point.note ? `Go back to “${point.note}”?` : `Go back to ${REASON_LABEL[point.reason].toLowerCase()}?`
}

/** The confirmation's body: what stops, where the worktree lands and what is lost. */
export function goBackBody(point: Pick<RestorePoint, 'commit'>, loss: RestoreLoss, repo: string): string {
  const stops = loss.stops ? `This stops ${loss.stops.name}’s Session and puts ` : 'This puts '
  const lost = lostPhrase(loss)
  return (
    `${stops}the ${repo} worktree back at ${shortCommit(point.commit)}. ` +
    `${lost} A restore point of what is there now is kept, so you can come back.`
  )
}

/** The sentence naming what going back throws away. */
function lostPhrase(loss: RestoreLoss): string {
  const commits =
    loss.commits.length === 0
      ? null
      : `${loss.commits.length} commit${loss.commits.length === 1 ? '' : 's'} (${loss.commits
          .map((subject) => `“${subject}”`)
          .join(', ')})`
  const uncommitted = loss.uncommitted ? 'the uncommitted work there' : null
  const both = [commits, uncommitted].filter((part) => part !== null)
  if (both.length === 0) return 'Nothing is lost: the worktree is already there.'
  return `It loses ${both.join(' and ')}.`
}

/** One row of the list: when it was taken, what kind it is and what the Employee said. */
export function pointLine(point: RestorePoint, now: Date): { when: string; kind: string; note: string } {
  return {
    when: clockTime(new Date(point.takenAt), now),
    kind: REASON_LABEL[point.reason],
    note: point.reason === 'start' ? '' : point.note,
  }
}
