import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup({ withoutRemote = false }: { withoutRemote?: boolean } = {}) {
  const git = fakeGit()
  if (withoutRemote) git.withoutRemote(onDisk('/code/web'))
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    git,
    log: () => {},
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  async function ticketInReview() {
    const ticket = engine.board().createTicket({ title: 'Currency helper', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).worktrees).toHaveLength(1))
    return ticket
  }
  return { engine, git, web, ada, ticketInReview }
}

describe('review line comments', () => {
  it('keeps a comment, posts it on the PR and wakes the ticket’s assignee', async () => {
    const { engine, git, web, ada, ticketInReview } = setup()
    const ticket = await ticketInReview()
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    const [pr] = engine.code.of(ticket.id).pullRequests

    const comment = engine.reviews.comment({
      ticketId: ticket.id,
      repoId: web.id,
      path: 'src/format/currency.ts',
      line: 19,
      body: 'Intl throws on an unknown locale. Worth a fallback to `en-US`.',
    })

    expect(comment).toMatchObject({
      ticketId: ticket.id,
      repoId: web.id,
      path: 'src/format/currency.ts',
      line: 19,
      authorId: BOSS,
      body: 'Intl throws on an unknown locale. Worth a fallback to `en-US`.',
    })
    expect(engine.reviews.comments(ticket.id)).toEqual([expect.objectContaining({ id: comment.id })])

    expect(git.lineComments).toEqual([
      {
        repoPath: onDisk('/code/web'),
        url: pr!.url,
        path: 'src/format/currency.ts',
        line: 19,
        body: 'Intl throws on an unknown locale. Worth a fallback to `en-US`.',
      },
    ])
    // The URL GitHub gave the comment lands on the row once the post comes back.
    await vi.waitFor(() => expect(engine.reviews.comments(ticket.id)[0]!.url).toBe(`${pr!.url}#discussion_r1`))

    const wake = engine.inbox.list(ada.id).find((item) => item.text.startsWith('Review comment'))
    expect(wake).toMatchObject({ kind: 'review', fromId: BOSS, ticketId: ticket.id })
    expect(wake!.text).toContain('web src/format/currency.ts:19')
    expect(wake!.prompt).toContain('Intl throws on an unknown locale')
  })

  it('keeps a comment in a repo without a remote, and still wakes the assignee', async () => {
    const { engine, git, web, ada, ticketInReview } = setup({ withoutRemote: true })
    const ticket = await ticketInReview()

    engine.reviews.comment({ ticketId: ticket.id, repoId: web.id, path: 'a.ts', line: 3, body: 'Rename this.' })

    expect(engine.code.of(ticket.id).pullRequests).toEqual([])
    expect(git.lineComments).toEqual([])
    expect(engine.reviews.comments(ticket.id)).toEqual([
      expect.objectContaining({ path: 'a.ts', line: 3, url: null, body: 'Rename this.' }),
    ])
    expect(engine.inbox.list(ada.id).some((item) => item.text === 'Review comment on web a.ts:3: Rename this.')).toBe(
      true,
    )
  })

  it('keeps the comment when gh cannot post it', async () => {
    const { engine, git, web, ticketInReview } = setup()
    const ticket = await ticketInReview()
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    const [pr] = engine.code.of(ticket.id).pullRequests
    git.failLineComment(pr!.url, 'gh api pulls/comments failed: 422')

    const comment = engine.reviews.comment({ ticketId: ticket.id, repoId: web.id, path: 'a.ts', line: 1, body: 'Hm' })

    await vi.waitFor(() => expect(git.lineComments).toHaveLength(1))
    expect(engine.reviews.comments(ticket.id)).toEqual([expect.objectContaining({ id: comment.id, url: null })])
  })

  it('refuses an empty comment, an unknown ticket and a repo outside the Company', async () => {
    const { engine, web, ticketInReview } = setup()
    const ticket = await ticketInReview()

    expect(() =>
      engine.reviews.comment({ ticketId: ticket.id, repoId: web.id, path: 'a.ts', line: 1, body: ' ' }),
    ).toThrow(/needs some text/)
    expect(() => engine.reviews.comment({ ticketId: 999, repoId: web.id, path: 'a.ts', line: 1, body: 'x' })).toThrow(
      /no ticket AC-999/,
    )
    expect(() =>
      engine.reviews.comment({ ticketId: ticket.id, repoId: 'gone', path: 'a.ts', line: 1, body: 'x' }),
    ).toThrow(/not in the Company/)
    expect(() =>
      engine.reviews.comment({ ticketId: ticket.id, repoId: web.id, path: 'a.ts', line: 0, body: 'x' }),
    ).toThrow(/needs a line/)
  })
})
