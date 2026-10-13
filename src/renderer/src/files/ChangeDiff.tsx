import type { Employee } from '../../../shared/domain/staff'
import {
  CHANGES_FOOTER,
  CHANGES_FOOTER_REPO,
  type ChangedFileDiff,
  NO_CHANGE_OPEN,
  NO_CHANGE_PICKED,
  noDiffReason,
} from '../../../shared/files/file-changes'
import type { FilePlace } from '../../../shared/files/files'
import { countsLabel, type ReviewComment } from '../../../shared/review/review-diff'
import { DiffControlBar, type DiffControls, DiffEditor } from '../editor'
import { CommentThread } from '../review'
import { cx } from '../ui'
import { crumbsOf } from './files-model'
import { BODY, CHANGES_EMPTY, CHIP, CHIP_PLAIN, CRUMB, CRUMBS, FOOT, HEAD, VIEWER } from './Viewers'

export interface ChangeDiffProps {
  /** The place the change is in; the foot says whether there is a ticket to comment to. */
  place: FilePlace | null
  /** Null while nothing is picked, or while the diff is being read. */
  diff: ChangedFileDiff | null
  /** True while the diff is being read, so an empty pane does not read as an empty diff. */
  loading?: boolean
  error?: string | null
  /** The layout and the walk through the changes, so the head can draw the bar (T243). */
  controls: DiffControls
  /** The ticket's line comments, where the place is a worktree; empty for the Company's own repo. */
  comments?: readonly ReviewComment[] | undefined
  employees?: readonly Employee[] | undefined
  bossName?: string | undefined
  commentOn?: number | null
  onCommentOn?: ((line: number | null) => void) | undefined
  onComment?: ((line: number, body: string) => void) | undefined
}

/**
 * The diff beside the list: VS Code's own diff editor over a worktree instead of a PR (T243), which
 * is the same editor the Review screen draws a PR with. Read only — a comment on a line goes to
 * whoever holds the ticket, which is the review screen's comment, written from here.
 */
export function ChangeDiff({
  place,
  diff,
  loading = false,
  error = null,
  controls,
  comments,
  employees,
  bossName,
  commentOn = null,
  onCommentOn,
  onComment,
}: ChangeDiffProps) {
  // With nothing picked there is no place to speak for, so the foot keeps the worktree's words.
  const ticket = place === null || place.ticketId !== null
  const path = diff?.file.path ?? ''
  const mine = (comments ?? []).filter((comment) => comment.path === path)
  const lines = [...new Set([...mine.map((comment) => comment.line), ...(commentOn === null ? [] : [commentOn])])].sort(
    (a, b) => a - b,
  )
  return (
    <section className={VIEWER} aria-label="Diff">
      <header className={HEAD}>
        <nav className={CRUMBS} aria-label="Path">
          {diff === null ? (
            <span className={CRUMB}>{NO_CHANGE_OPEN}</span>
          ) : (
            // Every crumb reads the same, as the file viewer's do.
            crumbsOf(path).map((crumb, index) => (
              <span key={index} className={CRUMB}>
                {crumb}
              </span>
            ))
          )}
        </nav>
        {diff !== null && (
          <span className="flex shrink-0 items-center gap-8">
            <DiffControlBar controls={controls} />
            <span className={cx(CHIP, CHIP_PLAIN)}>{countsLabel(diff.file)}</span>
          </span>
        )}
      </header>
      {error && <p className="m-0 shrink-0 p-16 text-13/[normal] text-destructive">{error}</p>}
      {diff === null ? (
        <div className={cx(BODY, 'pb-16')}>
          <p className={CHANGES_EMPTY}>{loading ? 'Reading the diff…' : NO_CHANGE_PICKED}</p>
        </div>
      ) : diff.sides.binary || (diff.sides.original === '' && diff.sides.modified === '') ? (
        <div className={cx(BODY, 'pb-16')}>
          <p className={CHANGES_EMPTY}>{noDiffReason(diff.file)}</p>
        </div>
      ) : (
        /* Monaco is given the box and sizes itself inside it, so this is a flex column and never
           the scrolling `BODY` the text viewers use: a `flex-1` in a block parent is no height at
           all, and the editor draws nothing. */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DiffEditor
            path={path}
            original={diff.sides.original}
            modified={diff.sides.modified}
            overlays={lines.map((line) => ({ id: `line-${line}`, line }))}
            marks={mine.map((comment) => ({ line: comment.line, kind: 'comment' as const }))}
            // Only a worktree has a ticket, and only a ticket has somebody to comment to.
            onCommentOn={ticket && onCommentOn ? (line) => onCommentOn(line === commentOn ? null : line) : undefined}
            {...controls.bind}
          >
            {(overlay) => (
              <div className="bg-card" data-thread-line={overlay.line}>
                <CommentThread
                  comments={mine.filter((comment) => comment.line === overlay.line)}
                  employees={[...(employees ?? [])]}
                  bossName={bossName ?? ''}
                  line={overlay.line}
                  onComment={(body) => onComment?.(overlay.line, body)}
                />
              </div>
            )}
          </DiffEditor>
        </div>
      )}
      <footer className={FOOT}>{ticket ? CHANGES_FOOTER : CHANGES_FOOTER_REPO}</footer>
    </section>
  )
}
