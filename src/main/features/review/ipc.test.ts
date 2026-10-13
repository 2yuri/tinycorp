import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewChannels } from '../../../shared/domain/channels'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { registerReviewIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-old
+new
`

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    git,
    log: () => {},
  })
  engines.push(engine)
  let broadcasts = 0
  registerReviewIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)

  let webId = ''
  async function inDoing() {
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
    webId = web.id
    const ticket = engine.board().createTicket({ title: 'Login', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).worktrees).toHaveLength(1))
    return ticket
  }
  async function inReview() {
    const ticket = await inDoing()
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    return ticket
  }
  return { engine, git, invoke, inDoing, inReview, broadcasts: () => broadcasts, webId: () => webId }
}

describe('Review IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(reviewChannels.list)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('lists review rounds and broadcasts when they change', async () => {
    const { invoke, inReview, broadcasts } = setup()

    const ticket = await inReview()

    expect(await invoke(reviewChannels.list)).toEqual({
      ok: true,
      value: [expect.objectContaining({ ticketId: ticket.id, reviewerId: BOSS, status: 'pending' })],
    })
    expect(broadcasts()).toBeGreaterThan(0)
  })

  it('approves as the boss, which merges', async () => {
    const { engine, invoke, inReview } = setup()
    const ticket = await inReview()

    expect(await invoke(reviewChannels.approve, ticket.id, 'Ship it')).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'approved', decidedBy: BOSS, comments: 'Ship it' }),
    })
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.merge).toBe('merged'))
  })

  it('requests changes as the boss, and needs comments to', async () => {
    const { engine, invoke, inReview } = setup()
    const ticket = await inReview()

    expect(await invoke(reviewChannels.requestChanges, ticket.id)).toEqual({
      ok: false,
      error: expect.stringMatching(/comments/),
    })
    expect(await invoke(reviewChannels.requestChanges, ticket.id, 'Rename it')).toMatchObject({
      ok: true,
      value: { status: 'changes_requested' },
    })
    expect(engine.board().snapshot().tickets[0]!.column).toBe('doing')
  })

  it('reads a ticket’s changed files', async () => {
    const { engine, git, invoke, inReview } = setup()
    const ticket = await inReview()
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    git.setDiff(engine.code.of(ticket.id).pullRequests[0]!.url, PATCH)

    const result = (await invoke(reviewChannels.diff, ticket.id)) as { ok: true; value: unknown[] }

    expect(result.ok).toBe(true)
    expect(result.value).toEqual([
      expect.objectContaining({
        url: engine.code.of(ticket.id).pullRequests[0]!.url,
        files: [expect.objectContaining({ path: 'a.ts' })],
      }),
    ])
  })

  it('reads the diff of a ticket that has a branch and no PR at all (T82)', async () => {
    const { engine, git, invoke, inDoing } = setup()
    git.withoutRemote(onDisk('/code/web'))
    const ticket = await inDoing()
    const branch = engine.code.of(ticket.id).worktrees[0]!.branch
    git.setBranchDiff(branch, PATCH)

    const result = (await invoke(reviewChannels.diff, ticket.id)) as { ok: true; value: unknown[] }

    expect(engine.code.of(ticket.id).pullRequests).toEqual([])
    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          url: null,
          refusal: { badge: 'No remote', reason: 'No remote, cannot open a PR' },
          head: branch,
          files: [expect.objectContaining({ path: 'a.ts' })],
        }),
      ],
    })
  })

  it('writes a line comment, lists it and broadcasts', async () => {
    const { invoke, inReview, webId } = setup()
    const ticket = await inReview()
    const before = (await invoke(reviewChannels.comments, ticket.id)) as { value: unknown[] }
    expect(before.value).toEqual([])

    const written = await invoke(reviewChannels.comment, {
      ticketId: ticket.id,
      repoId: webId(),
      path: 'a.ts',
      line: 2,
      body: 'Guard the locale.',
    })

    expect(written).toEqual({
      ok: true,
      value: expect.objectContaining({ path: 'a.ts', line: 2, body: 'Guard the locale.' }),
    })
    expect(await invoke(reviewChannels.comments, ticket.id)).toEqual({
      ok: true,
      value: [expect.objectContaining({ line: 2 })],
    })
  })

  it('refuses a comment without a file, a line or a repo', async () => {
    const { invoke, inReview, webId } = setup()
    const ticket = await inReview()

    expect(await invoke(reviewChannels.comment, { ticketId: ticket.id, repoId: webId(), line: 2, body: 'x' })).toEqual({
      ok: false,
      error: expect.stringMatching(/file path/i),
    })
    expect(
      await invoke(reviewChannels.comment, { ticketId: ticket.id, repoId: webId(), path: 'a.ts', line: 0, body: 'x' }),
    ).toEqual({ ok: false, error: expect.stringMatching(/line/i) })
    expect(await invoke(reviewChannels.comment, { ticketId: ticket.id, path: 'a.ts', line: 1, body: 'x' })).toEqual({
      ok: false,
      error: expect.stringMatching(/repo id/i),
    })
  })

  it('refuses a ticket id that is not a number', async () => {
    const { invoke, inReview } = setup()
    await inReview()

    expect(await invoke(reviewChannels.approve, '1')).toEqual({ ok: false, error: expect.stringMatching(/ticket id/i) })
  })
})
