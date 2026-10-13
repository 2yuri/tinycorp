import { GitPullRequestArrow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BOSS } from '../../../shared/domain/chat'
import type { Result } from '../../../shared/domain/result'
import { countsLabel } from '../../../shared/review/review-diff'
import { ViewHeader } from '../chrome'
import { useDiffControls } from '../editor'
import { PersonAvatar } from '../people'
import { Avatar, AvatarStack, cx, EmptyState } from '../ui'
import type { ReviewTarget } from './open-review'
import { DiffView, FileList, ReviewPanel } from './ReviewParts'
import {
  canDecide,
  reviewerLabel,
  reviewerName,
  reviewRoundLine,
  reviewSubtitle,
  reviewTitle,
  roundSummary,
  unresolvedComments,
} from './review-model'
import { useFileSides } from './use-file-sides'
import { useReviewData } from './use-review-data'
import '../ui/tailwind.css'

/** The badge portaled into the shell's header (review.html:2246-2280). */
export const REVIEW_BADGE = 'rounded-full bg-secondary px-11 py-5 text-12/[inherit] font-semibold text-soft-ink'

const api = window.tinyCorp.reviews

/**
 * Reviewing a ticket's PR inside the app (frame `ZCYGy`): the changed files on the left, the
 * unified diff in the middle with a comment thread under any line, and the review panel on the
 * right with Approve & merge and Request changes, which go through the flow's gates.
 */
export function ReviewScreen({ target, onClose }: { target: ReviewTarget; onClose(): void }) {
  const data = useReviewData(target.ticketId)
  const [repoId, setRepoId] = useState<string | null>(target.repoId ?? null)
  // The file the boss is reading, with the repo it is in: picking another repo starts that repo on
  // its first file again, which is what the pair says rather than an effect that clears one (T211).
  const [picked, setPicked] = useState<{ repoId: string; path: string } | null>(null)
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set())
  const [commentOn, setCommentOn] = useState<number | null>(null)
  const [jumpTo, setJumpTo] = useState<{ path: string; line: number | null } | null>(null)
  /** The line the editor was last asked to scroll to, and how many times it has been asked. */
  const [reveal, setReveal] = useState({ seq: 0, line: 0 })
  const [comments, setComments] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ticket = data.board?.tickets.find((t) => t.id === target.ticketId) ?? null
  const diff = data.diffs.find((d) => d.repoId === repoId) ?? data.diffs[0] ?? null
  const details = data.details.find((d) => d.repoId === diff?.repoId) ?? null
  const path = picked !== null && picked.repoId === diff?.repoId ? picked.path : null
  const pickFile = (next: string) => setPicked(diff ? { repoId: diff.repoId, path: next } : null)
  const file = diff?.files.find((f) => f.path === path) ?? diff?.files[0] ?? null
  const controls = useDiffControls()
  // A new head is a new set of files, and every set of sides read against the old one is stale.
  const generation = useMemo(
    () => data.diffs.map((one) => `${one.repoId}@${one.head}:${one.files.map(countsLabel).join(',')}`).join('|'),
    [data.diffs],
  )
  const reading = useFileSides(
    target.ticketId,
    diff && file ? { repoId: diff.repoId, path: file.path } : null,
    generation,
  )
  const repoName = data.repos.find((r) => r.id === diff?.repoId)?.name ?? 'the repo'
  const nameOf = (id: string) => (id === BOSS ? (data.company?.boss.name ?? 'you') : reviewerName(id, data.employees))
  // The verdict sentence names the role that gave it; everywhere else the name stands alone.
  const labelOf = (id: string) => (id === BOSS ? nameOf(id) : reviewerLabel(id, data.employees))
  const bossName = data.company?.boss.name || 'You'
  const fileComments = useMemo(
    () => data.comments.filter((c) => c.repoId === diff?.repoId),
    [data.comments, diff?.repoId],
  )
  const unresolved = unresolvedComments(fileComments, data.review)
  const decidable = canDecide(data.review, ticket?.column ?? '')
  const fileThreads = useMemo(
    () => data.threads.filter((thread) => thread.repoId === null || thread.repoId === diff?.repoId),
    [data.threads, diff?.repoId],
  )
  // A finding's thread takes the shield in the gutter rather than the speech bubble (T241).
  const findingThreads = useMemo(
    () => new Set((data.security?.findings ?? []).map((finding) => finding.threadId)),
    [data.security],
  )
  const threadPeople = {
    employees: data.employees,
    bossName,
    reviewerId: data.review?.reviewerId ?? null,
  }
  const threadActions = {
    onReply: (threadId: number, body: string) => void run(() => api.replyInThread(threadId, body)),
    onResolve: (threadId: number, resolved: boolean) =>
      void run(() => api.setThreadState(threadId, resolved ? 'resolved' : 'open')),
  }

  /*
   * `Jump to open thread` opens the file the thread is in, and asks the editor for its line once
   * that file is drawn. The editor rather than the zone, because an unchanged stretch is folded
   * away and a thread inside one has nothing on the page to scroll to (T243).
   */
  useEffect(() => {
    if (!jumpTo || jumpTo.line === null) return
    if (file?.path !== jumpTo.path) return
    setReveal((was) => ({ seq: was.seq + 1, line: jumpTo.line ?? 1 }))
    setJumpTo(null)
  }, [jumpTo, file?.path])

  async function run(action: () => Promise<Result<unknown>>): Promise<boolean> {
    setBusy(true)
    const result = await action()
    setBusy(false)
    setError(result.ok ? null : result.error)
    return result.ok
  }

  /** A decision spends the panel's comment box; a line comment leaves that draft alone. */
  async function decide(action: () => Promise<Result<unknown>>): Promise<void> {
    if (await run(action)) setComments('')
  }

  function writeComment(line: number, body: string): void {
    if (!diff) return
    setCommentOn(null)
    void run(() => api.comment({ ticketId: target.ticketId, repoId: diff.repoId, path: file?.path ?? '', line, body }))
  }

  const round = reviewRoundLine({ repoName, details, review: data.review })
  const subtitle = reviewSubtitle({
    repoName,
    details,
    diff,
    openedBy: ticket?.assigneeId ? nameOf(ticket.assigneeId) : null,
  })

  return (
    <div className="flex min-h-0 flex-[1_1_0] flex-col overflow-hidden" data-ui="Review">
      <ViewHeader
        title={reviewTitle(data.company?.key ?? 'TC', target.ticketId, ticket?.title ?? 'This ticket')}
        badge={decidable ? <span className={REVIEW_BADGE}>Waiting on you</span> : undefined}
        subtitle={subtitle}
      >
        <span className="flex items-center gap-8">
          <AvatarStack>
            {data.employees.slice(0, 3).map((employee) => (
              <PersonAvatar
                key={employee.id}
                id={employee.id}
                name={employee.name}
                people={{
                  employees: data.employees,
                  bossInitials: data.company?.boss.initials,
                  bossSprite: data.company?.boss.sprite,
                }}
                size={30}
              />
            ))}
            {data.employees.length > 3 && (
              <Avatar name={`${data.employees.length - 3} more`} text={`+${data.employees.length - 3}`} size={30} />
            )}
          </AvatarStack>
        </span>
      </ViewHeader>
      {data.diffs.length === 0 && !data.loading ? (
        <div className="flex flex-[1_1_0] items-center justify-center p-32">
          <EmptyState
            icon={GitPullRequestArrow}
            title="Nothing to review yet"
            body={
              data.error ??
              'This ticket has no branch to read yet. It gets one when it moves to Doing — a PR only where the repo has a remote.'
            }
          />
        </div>
      ) : (
        <>
          {data.diffs.length > 1 && (
            <div
              className="flex shrink-0 gap-8 border-border border-b bg-card px-16 py-8"
              role="tablist"
              aria-label="Repositories"
            >
              {data.diffs.map((entry) => (
                <button
                  key={entry.repoId}
                  type="button"
                  role="tab"
                  aria-selected={entry.repoId === diff?.repoId}
                  className={cx(
                    'cursor-pointer rounded-full border px-10 py-3 font-semibold text-11/[inherit]',
                    entry.repoId === diff?.repoId
                      ? 'border-border bg-secondary text-secondary-foreground'
                      : 'border-transparent bg-transparent text-muted-foreground',
                  )}
                  onClick={() => setRepoId(entry.repoId)}
                >
                  {data.repos.find((r) => r.id === entry.repoId)?.name ?? 'removed repo'}
                </button>
              ))}
            </div>
          )}
          <div className="flex min-h-0 flex-[1_1_0]">
            <FileList
              files={diff?.files ?? []}
              comments={fileComments}
              viewed={viewed}
              activePath={file?.path ?? null}
              onPick={(next) => {
                pickFile(next)
                setCommentOn(null)
              }}
              // A file the pointer rests on is very likely the next one read, so its two sides are
              // fetched before the click lands and the diff is there the moment it does (T243).
              onHover={(next) => diff && reading.prefetch(diff.repoId, next)}
            />
            <DiffView
              file={file}
              sides={reading.sides}
              loading={reading.loading}
              sidesError={reading.error}
              controls={controls}
              reveal={reveal}
              talk={{
                comments: fileComments.filter((comment) => comment.path === file?.path),
                threads: fileThreads.filter((thread) => thread.path === file?.path),
                findingThreads: findingThreads,
              }}
              threadPeople={threadPeople}
              threadActions={threadActions}
              employees={data.employees}
              bossName={bossName}
              viewed={file ? viewed.has(file.path) : false}
              url={diff?.url ? `${diff.url}/files` : null}
              onToggleViewed={() =>
                file &&
                setViewed((current) => {
                  const next = new Set(current)
                  if (!next.delete(file.path)) next.add(file.path)
                  return next
                })
              }
              commentOn={commentOn}
              onCommentOn={setCommentOn}
              onComment={writeComment}
            />
            <ReviewPanel
              repoName={repoName}
              details={details}
              diff={diff}
              review={data.review}
              round={round}
              summary={roundSummary(data.review, unresolved.length, labelOf)}
              unresolved={unresolved}
              threads={data.threads}
              onForge={data.threadsOnForge}
              security={data.security}
              onOverrideSecurity={() => void decide(() => api.overrideSecurity(target.ticketId, comments))}
              onJumpTo={(thread) => {
                if (thread.path) pickFile(thread.path)
                setJumpTo({ path: thread.path ?? '', line: thread.line })
              }}
              employees={data.employees}
              bossName={bossName}
              comments={comments}
              busy={busy}
              canDecide={decidable}
              error={error}
              onComments={setComments}
              onApprove={() => void decide(() => api.approve(target.ticketId, comments))}
              onRequestChanges={() => void decide(() => api.requestChanges(target.ticketId, comments))}
              onClose={onClose}
            />
          </div>
        </>
      )}
    </div>
  )
}
