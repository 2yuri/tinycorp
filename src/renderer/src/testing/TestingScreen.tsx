import { FlaskConical } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BOSS } from '../../../shared/domain/chat'
import type { Result } from '../../../shared/domain/result'
import { clockTime } from '../../../shared/platform/clock-time'
import { testCounts } from '../../../shared/testing'
import { navigate, ViewHeader } from '../chrome'
import { openReview } from '../review'
import { EmptyState, focusOnMount } from '../ui'
import type { TestingTarget } from './open-testing'
import { EvidencePanel, RunIt, ScriptHeader, SECTION_LABEL, StepCard, TestingActions } from './TestingParts'
import { modeLine, namerFor, testingBadge, testingSubtitle, testingTitle } from './testing-model'
import { useTestingData } from './use-testing-data'
import '../ui/tailwind.css'

/** A notice or an error above the script, both on the frame's 13px line. */
const NOTICE = 'mx-0 mt-0 mb-12 text-13/[inherit] text-muted-foreground'
/** `Add` and `Cancel` beside the new-step field. */
const ADDING_BUTTON =
  'cursor-pointer rounded-sm border border-border bg-secondary px-12 py-8 text-13/[inherit] text-foreground'

const api = window.tinyCorp.tests

/**
 * Manual QA before the merge (frame `BRzY6`): the ticket's own worktree running beside the test
 * script the plan's acceptance criteria wrote, each step passed or failed with a note and a
 * screenshot, and what the QA agent already verified in the panel on the right.
 */
export function TestingScreen({ target, onClose }: { target: TestingTarget; onClose(): void }) {
  const [logOf, setLogOf] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({})
  const picker = useRef<HTMLInputElement | null>(null)
  const pickingFor = useRef<number | null>(null)
  const data = useTestingData(target.ticketId, logOf)

  const ticket = data.board?.tickets.find((t) => t.id === target.ticketId) ?? null
  const run = data.run
  const bossName = data.company?.boss.name || 'You'
  const nameOf = namerFor(data.employees, bossName)
  const agentName = run?.agentId ? nameOf(run.agentId) : null
  const repoName = (id: string) => data.repos.find((repo) => repo.id === id)?.name ?? 'removed repo'
  const clock = (iso: string) => clockTime(new Date(iso), new Date())
  const running = data.runnable.find((repo) => repo.run?.state === 'running') ?? null

  async function act(action: () => Promise<Result<unknown>>): Promise<void> {
    setBusy(true)
    const result = await action()
    setBusy(false)
    setError(result.ok ? null : result.error)
  }

  // Every screenshot the attempt carries, read once each so a thumbnail can be drawn beside its step.
  useEffect(() => {
    const ids = (run?.steps ?? []).flatMap((step) => step.attachments.map((attachment) => attachment.id))
    const missing = ids.filter((id) => thumbnails[id] === undefined)
    if (missing.length === 0) return
    let live = true
    void Promise.all(missing.map((id) => window.tinyCorp.tests.openAttachment(id))).then((results) => {
      if (!live) return
      const next: Record<number, string> = {}
      for (const result of results) {
        if (result.ok && result.value.dataUrl) next[result.value.id] = result.value.dataUrl
      }
      if (Object.keys(next).length > 0) setThumbnails((current) => ({ ...current, ...next }))
    })
    return () => {
      live = false
    }
  }, [run, thumbnails])

  const pickFiles = useCallback((stepId: number) => {
    pickingFor.current = stepId
    picker.current?.click()
  }, [])

  /** The files the boss picked or pasted, kept beside `stepId`. */
  async function attachFiles(stepId: number | null, files: readonly File[]): Promise<void> {
    if (!stepId || files.length === 0) return
    const sources = await Promise.all(
      files.map(async (file, index) => ({
        // A pasted screenshot arrives as `image.png`, or with no name at all.
        name: file.name || `pasted-${index + 1}.png`,
        data: new Uint8Array(await file.arrayBuffer()),
      })),
    )
    await act(() => api.attach(stepId, sources))
  }

  const mode = modeLine(run, agentName)

  const counts = testCounts(run ?? { steps: [] })
  const timeline = [
    {
      tone: 'done' as const,
      title:
        data.review?.status === 'approved' ? `${nameOf(data.review.decidedBy ?? BOSS)} approved the review` : 'Review',
      detail:
        data.code?.pullRequests
          .map((pr) => `${repoName(pr.repoId)}${pr.number === null ? '' : ` #${pr.number}`}`)
          .join(', ') || 'no PR',
      at: data.review?.decidedAt ? clock(data.review.decidedAt) : null,
    },
    ...(run?.agentVerdict
      ? [
          {
            tone: 'done' as const,
            title: `${agentName ?? 'The QA agent'} tested on the worktree`,
            detail: `${counts.passed} of ${counts.total}${run.checks.length > 0 ? ` · ${run.checks.join(', ')}` : ''}`,
            at: run.finishedAt ? clock(run.finishedAt) : clock(run.startedAt),
          },
        ]
      : []),
    {
      tone: run?.state === 'you' ? ('now' as const) : ('next' as const),
      title: run?.state === 'you' ? 'You are testing' : 'Your turn to confirm',
      detail: `${counts.passed} passed · ${counts.failed} failed · ${counts.pending} to test`,
      at: null,
    },
    {
      tone: run?.state === 'passed' ? ('now' as const) : ('next' as const),
      title: 'Merge',
      detail: run?.state === 'passed' ? 'ready to go' : 'waits for Testing to pass',
      at: null,
    },
  ]

  return (
    <div className="flex min-h-0 flex-[1_1_0] flex-col overflow-hidden" data-ui="Testing">
      <ViewHeader
        title={testingTitle(data.company?.key ?? 'TC', target.ticketId, ticket?.title ?? 'This ticket')}
        badge={
          <span className="rounded-full bg-secondary px-11 py-5 font-semibold text-12/[inherit] text-soft-ink">
            {testingBadge(run, agentName)}
          </span>
        }
        subtitle={testingSubtitle({
          prs: (data.code?.pullRequests ?? []).map((pr) => ({ repoName: repoName(pr.repoId), number: pr.number })),
          worktree: data.code?.worktrees[0] ?? null,
          approvedBy: data.review?.decidedBy ? nameOf(data.review.decidedBy) : null,
          run,
        })}
      />
      {!run && !data.loading ? (
        <div className="flex flex-[1_1_0] items-center justify-center p-32">
          <EmptyState
            icon={FlaskConical}
            title="Nothing to test here"
            body={
              data.error ??
              'This ticket has not reached Testing. A ticket goes there when its review is approved, unless its repos are tested by nobody.'
            }
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-[1_1_0]">
          <div className="flex min-h-0 min-w-0 flex-[1_1_0] flex-col">
            <section className="px-24 pt-16 pb-0">
              <div className="flex items-center gap-8 pb-8">
                <h2 className={SECTION_LABEL}>Run it</h2>
                <span className="ml-auto text-12/[inherit] text-muted-foreground">
                  The ticket’s worktree, before merge
                </span>
              </div>
              {data.runnable.length === 0 ? (
                <p className={NOTICE}>
                  No repo of this ticket has a run command. Set one in Company settings → Testing to run it from here.
                </p>
              ) : (
                data.runnable.map((repo, index) => (
                  <RunIt
                    key={repo.repoId}
                    className={index === 0 ? undefined : 'mt-8'}
                    repo={repo}
                    log={logOf === repo.repoId ? data.log : []}
                    logOpen={logOf === repo.repoId}
                    busy={busy}
                    onToggleLog={() => setLogOf((current) => (current === repo.repoId ? null : repo.repoId))}
                    onStart={() => void act(() => api.startApp(target.ticketId, repo.repoId))}
                    onStop={() => void act(() => api.stopApp(target.ticketId, repo.repoId))}
                  />
                ))
              )}
            </section>
            <section className="flex min-h-0 flex-[1_1_0] flex-col overflow-auto px-24 pt-16 pb-0">
              <ScriptHeader
                run={run}
                agentName={agentName}
                canTest={run?.state === 'you'}
                onAddStep={() => setAdding(' ')}
              />
              {adding !== '' && (
                <form
                  className="flex gap-8 pb-8"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const title = adding.trim()
                    if (!title) return setAdding('')
                    void act(() => api.addStep(target.ticketId, title)).then(() => setAdding(''))
                  }}
                >
                  <input
                    ref={focusOnMount}
                    className="flex-[1_1_0] rounded-sm border border-border bg-input px-10 py-8 text-13/[inherit] text-foreground"
                    value={adding.trimStart()}
                    placeholder="What should be checked?"
                    onChange={(event) => setAdding(event.target.value || ' ')}
                    onKeyDown={(event) => event.key === 'Escape' && setAdding('')}
                  />
                  <button type="submit" className={ADDING_BUTTON}>
                    Add
                  </button>
                  <button type="button" className={ADDING_BUTTON} onClick={() => setAdding('')}>
                    Cancel
                  </button>
                </form>
              )}
              {run && run.steps.length === 0 && (
                <p className={NOTICE}>
                  The plan set no acceptance criteria, so this script is empty. Add the steps worth checking, or pass it
                  as it is.
                </p>
              )}
              <ul className="m-0 flex list-none flex-col gap-8 px-0 pt-0 pb-16">
                {(run?.steps ?? []).map((step, index) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    number={index + 1}
                    canTest={run?.state === 'you'}
                    nameOf={nameOf}
                    thumbnails={thumbnails}
                    canCapture={running !== null}
                    onResult={(result) => void act(() => api.setStep(step.id, result))}
                    onNote={(note) => void act(() => api.setStep(step.id, step.result, note))}
                    onAttach={() => pickFiles(step.id)}
                    onPaste={(files) => void attachFiles(step.id, files)}
                    onCapture={() => running && void act(() => api.capture(step.id, target.ticketId, running.repoId))}
                  />
                ))}
              </ul>
              {error && <p className="mx-0 mt-0 mb-12 text-13/[inherit] text-status-error-foreground">{error}</p>}
            </section>
            <TestingActions
              run={run}
              busy={busy}
              onReportBug={() => void act(() => api.reportBug(target.ticketId))}
              onPass={() => void act(() => api.pass(target.ticketId))}
            />
          </div>
          <EvidencePanel
            run={run}
            mode={mode}
            agentName={agentName}
            timeline={timeline}
            onChangeMode={() => navigate({ view: 'settings', tab: 'general' })}
            onOpenReview={() => openReview({ ticketId: target.ticketId })}
            onClose={onClose}
          />
        </div>
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void attachFiles(pickingFor.current, [...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
    </div>
  )
}
