import { describe, expect, it } from 'vitest'
import type { PullRequestDetails } from '../../../shared/code'
import { BOSS } from '../../../shared/domain/chat'
import type { Review } from '../../../shared/review'
import type { DiffFile, RepoDiff, ReviewComment } from '../../../shared/review/review-diff'
import type { DiffSummary } from './review-model'
import {
  branchLine,
  canDecide,
  checksLine,
  commentsOn,
  durationLabel,
  fileRows,
  filesCaption,
  mergeabilityLabel,
  reviewerLabel,
  reviewerName,
  reviewRoundLine,
  reviewSubtitle,
  reviewTitle,
  roundSummary,
  unresolvedComments,
  unresolvedLabel,
} from './review-model'

function file(path: string, additions: number, deletions: number): DiffFile {
  return { path, previousPath: null, status: 'modified', additions, deletions, binary: false }
}

function comment(path: string, line: number, createdAt = '2026-09-17T09:33:00.000Z'): ReviewComment {
  return { id: line, ticketId: 1, repoId: 'r', path, line, authorId: BOSS, body: 'Hm', url: null, createdAt }
}

const review: Review = {
  id: 1,
  round: 1,
  rounds: 1,
  handoff: 'agents',
  roundLimit: 3,
  ticketId: 1,
  reviewerId: 'e-iris',
  status: 'pending',
  decidedBy: null,
  comments: '',
  merge: null,
  approvalId: null,
  mergedRepoIds: [],
  mergeError: null,
  messageId: 1,
  requestedAt: '2026-09-17T09:00:00.000Z',
  decidedAt: null,
}

const details: PullRequestDetails = {
  ticketId: 1,
  repoId: 'r',
  url: 'https://github.com/acme/app/pull/131',
  number: 131,
  title: 'Currency + locale formatting helper',
  state: 'open',
  head: 'feat/locale-format',
  base: 'main',
  additions: 142,
  deletions: 38,
  changedFiles: 6,
  mergeable: 'mergeable',
  checks: [
    { name: 'build', workflow: 'pnpm build', state: 'passing', durationMs: 28_000 },
    { name: 'tests', workflow: 'vitest', state: 'passing', durationMs: 64_000 },
    { name: 'lint', workflow: 'biome', state: 'pending', durationMs: null },
  ],
}

describe('review model', () => {
  it('captions the file list with the count and the totals', () => {
    expect(filesCaption([file('a.ts', 64, 4), file('b.ts', 78, 34)])).toBe('2 FILES · +142 −38')
    expect(filesCaption([file('a.ts', 1, 0)])).toBe('1 FILE · +1 −0')
    expect(filesCaption([])).toBe('0 FILES · +0 −0')
  })

  it('splits each file into its name and its folder, with counts, comments and the viewed tick', () => {
    const rows = fileRows(
      [file('src/format/currency.ts', 64, 4), file('package.json', 0, 0)],
      [comment('src/format/currency.ts', 19), comment('src/format/currency.ts', 20)],
      new Set(['package.json']),
    )

    expect(rows).toEqual([
      {
        path: 'src/format/currency.ts',
        name: 'currency.ts',
        dir: 'src/format/',
        additions: 64,
        deletions: 4,
        comments: 2,
        viewed: false,
      },
      { path: 'package.json', name: 'package.json', dir: '', additions: 0, deletions: 0, comments: 0, viewed: true },
    ])
  })

  it('finds the comments on one line, and none for a line only the base has', () => {
    const comments = [comment('a.ts', 19), comment('a.ts', 20), comment('b.ts', 19)]

    expect(commentsOn(comments, 'a.ts', 19)).toEqual([comments[0]])
    expect(commentsOn(comments, 'a.ts', 99)).toEqual([])
    expect(commentsOn(comments, 'a.ts', null)).toEqual([])
  })

  it('counts as unresolved only the comments of the round under way', () => {
    const old = comment('a.ts', 1, '2026-09-17T08:00:00.000Z')
    const fresh = comment('a.ts', 2, '2026-09-17T09:33:00.000Z')

    expect(unresolvedComments([old, fresh], review)).toEqual([fresh])
    expect(unresolvedComments([old, fresh], null)).toEqual([old, fresh])
    expect(unresolvedLabel(1)).toBe('1 unresolved comment')
    expect(unresolvedLabel(3)).toBe('3 unresolved comments')
  })

  it('writes the branch line from the PR, falling back to the diff', () => {
    expect(branchLine(null, details)).toBe('feat/locale-format → main · +142 −38 · 6 files')
    const diff: RepoDiff = {
      repoId: 'r',
      url: null,
      refusal: null,
      head: 'ticket-1-x',
      base: 'main',
      files: [file('a.ts', 3, 1)],
    }
    expect(branchLine(diff, null)).toBe('ticket-1-x → main · +3 −1 · 1 file')
  })

  it('says what GitHub thinks of merging', () => {
    expect(mergeabilityLabel(details)).toEqual({ label: 'Mergeable', tone: 'ok' })
    expect(mergeabilityLabel({ ...details, mergeable: 'conflicting' })).toEqual({ label: 'Conflicting', tone: 'bad' })
    expect(mergeabilityLabel({ ...details, mergeable: 'unknown' })).toEqual({ label: 'Checking…', tone: 'unknown' })
    expect(mergeabilityLabel({ ...details, state: 'merged' })).toEqual({ label: 'Merged', tone: 'ok' })
    expect(mergeabilityLabel(null)).toEqual({ label: 'No PR', tone: 'unknown' })
  })

  it('carries the refusal’s own badge for a repo that can never have a PR', () => {
    const refusal = { badge: 'No remote', reason: 'No remote, cannot open a PR' }
    const local: RepoDiff = { repoId: 'r', url: null, refusal, head: 'ticket-1-x', base: 'main', files: [] }
    expect(mergeabilityLabel(null, local)).toEqual({ label: 'No remote', tone: 'unknown' })
    expect(mergeabilityLabel(null, { ...local, refusal: null })).toEqual({ label: 'No PR', tone: 'unknown' })
    // A repo on a forge with no adapter says which forge, and not `No remote`: it has one.
    const noForge = { badge: 'No forge', reason: 'No adapter for gitlab.example.com, cannot open a PR' }
    expect(mergeabilityLabel(null, { ...local, refusal: noForge })).toEqual({ label: 'No forge', tone: 'unknown' })
    // A PR outranks the branch: what the forge says about merging it is the stronger fact.
    expect(mergeabilityLabel(details, local)).toEqual({ label: 'Mergeable', tone: 'ok' })
  })

  it('heads the screen with the PR when there is one, and with the branch when there is not', () => {
    const remote: DiffSummary = { head: 'feat/locale-format', base: 'main', files: [], refusal: null }
    expect(reviewSubtitle({ repoName: 'billing-api', details, diff: remote, openedBy: 'Iris' })).toBe(
      'billing-api #131 · feat/locale-format → main · opened by Iris · 2 of 3 checks green',
    )
    expect(reviewSubtitle({ repoName: 'billing-api', details: null, diff: remote, openedBy: 'Iris' })).toBe(
      'billing-api · feat/locale-format → main · opened by Iris · No PR yet',
    )
    const local: DiffSummary = {
      head: 'ticket-9-currency',
      base: 'main',
      files: [],
      refusal: { badge: 'No remote', reason: 'No remote, cannot open a PR' },
    }
    expect(reviewSubtitle({ repoName: 'notes', details: null, diff: local, openedBy: null })).toBe(
      'notes · ticket-9-currency → main · No remote, cannot open a PR',
    )
  })

  it('shows each check’s duration and how many are green', () => {
    expect(details.checks.map(durationLabel)).toEqual(['28s', '1m 04s', ''])
    expect(checksLine(details.checks)).toBe('2 of 3 checks green')
    expect(checksLine([])).toBe('no checks')
  })

  it('summarises the round, naming who decided it and what is still open', () => {
    const name = (id: string) => (id === 'e-iris' ? 'Iris' : id === BOSS ? 'you' : id)

    expect(roundSummary(review, 1, name)).toBe('Waiting for Iris · 1 unresolved comment')
    expect(roundSummary({ ...review, status: 'approved', decidedBy: 'e-iris' }, 1, name)).toBe(
      'Iris approved · 1 unresolved comment',
    )
    expect(roundSummary({ ...review, status: 'approved', decidedBy: 'e-iris', merge: 'waiting' }, 0, name)).toBe(
      'Iris approved · the merge waits for you',
    )
    expect(roundSummary({ ...review, status: 'changes_requested', decidedBy: BOSS }, 0, name)).toBe(
      'you requested changes',
    )
    expect(roundSummary({ ...review, status: 'approved', decidedBy: BOSS, merge: 'merged' }, 0, name)).toBe('Merged')
    expect(roundSummary(null, 0, name)).toBe('Not in review yet')
  })

  it('names the role that gave the verdict, as the frame writes it', () => {
    const employees = [
      { id: 'e-iris', name: 'Iris', title: 'QA' },
      { id: 'e-vega', name: 'Vega', title: '' },
    ]

    expect(reviewerLabel('e-iris', employees)).toBe('Iris (QA)')
    expect(reviewerLabel('e-vega', employees)).toBe('Vega')
    expect(reviewerLabel(BOSS, employees)).toBe('you')
    expect(
      roundSummary({ ...review, status: 'approved', decidedBy: 'e-iris' }, 1, (id) => reviewerLabel(id, employees)),
    ).toBe('Iris (QA) approved · 1 unresolved comment')
  })

  it('heads the panel with the PR and the ticket’s own round count, never the row id', () => {
    // `id` is the review table's rowid, Company-wide: the ticket's second round can be row 37.
    const second = { ...review, id: 37, round: 2, rounds: 2 }

    expect(reviewRoundLine({ repoName: 'web-app', details, review: second })).toBe('web-app #131 · round 2 of 2')
    expect(reviewRoundLine({ repoName: 'web-app', details: null, review: second })).toBe('web-app · round 2 of 2')
    expect(reviewRoundLine({ repoName: 'web-app', details, review: null })).toBe('web-app #131')
  })

  it('reads the boss as you and an unknown id as a former employee', () => {
    const employees = [{ id: 'e-iris', name: 'Iris' }]

    expect(reviewerName(BOSS, employees)).toBe('you')
    expect(reviewerName('e-iris', employees)).toBe('Iris')
    expect(reviewerName('e-gone', employees)).toBe('a former employee')
  })

  it('titles the screen with the Company key and the ticket', () => {
    expect(reviewTitle('TC', 142, 'Currency + locale formatting helper')).toBe(
      'TC-142 · Currency + locale formatting helper',
    )
  })

  it('lets the boss decide only an open round on a ticket in review', () => {
    expect(canDecide(review, 'review')).toBe(true)
    expect(canDecide(review, 'doing')).toBe(false)
    expect(canDecide({ ...review, merge: 'merging' }, 'review')).toBe(false)
    expect(canDecide({ ...review, merge: 'merged' }, 'review')).toBe(false)
    expect(canDecide({ ...review, merge: 'failed' }, 'review')).toBe(true)
  })
})
