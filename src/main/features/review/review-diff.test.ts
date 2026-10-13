import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { createGitService } from '../../platform/git-service'
import { fakeGit } from '../../platform/testing'

const engines: CompanyEngine[] = []
const scratch: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// A machine with `commit.gpgsign` on would have these fixtures ask its GPG agent to sign.
const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false']

function run(cwd: string, ...args: string[]): void {
  execFileSync('git', [...identity, ...args], { cwd, stdio: 'ignore' })
}

const WEB_PATCH = `diff --git a/src/format/currency.ts b/src/format/currency.ts
--- a/src/format/currency.ts
+++ b/src/format/currency.ts
@@ -18,2 +18,2 @@ export function formatPrice(
-  return cents
+  return cents / 100
diff --git a/src/shared/locale.ts b/src/shared/locale.ts
new file mode 100644
--- /dev/null
+++ b/src/shared/locale.ts
@@ -0,0 +1,1 @@
+export const LOCALE = 'en-US'
`

const API_PATCH = `diff --git a/main.ts b/main.ts
--- a/main.ts
+++ b/main.ts
@@ -1,1 +1,1 @@
-old
+new
`

function setup({ now = () => 0, webWithoutRemote = false }: { now?: () => number; webWithoutRemote?: boolean } = {}) {
  const git = fakeGit()
  if (webWithoutRemote) git.withoutRemote(onDisk('/code/web'))
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    git,
    log: () => {},
    now,
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })
  async function ticketInDoing(repos = [web.id, api.id]) {
    const ticket = engine.board().createTicket({ title: 'Currency helper', assigneeId: ada.id, repos })
    engine.board().moveTicket(ticket.id, 'doing')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).worktrees).toHaveLength(repos.length))
    return ticket
  }
  async function ticketInReview(repos = [web.id, api.id]) {
    const ticket = await ticketInDoing(repos)
    engine.board().moveTicket(ticket.id, 'review')
    return ticket
  }
  return { engine, git, web, api, ada, ticketInDoing, ticketInReview }
}

describe('review diff', () => {
  it('reads each PR’s patch as a file list, in the ticket’s repo order', async () => {
    const { engine, git, web, api, ticketInReview } = setup()
    const ticket = await ticketInReview()
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
    const [webPr, apiPr] = engine.code.of(ticket.id).pullRequests
    git.setDiff(webPr!.url, WEB_PATCH)
    git.setDiff(apiPr!.url, API_PATCH)

    const diffs = await engine.reviews.diff(ticket.id)

    expect(diffs.map((d) => [d.repoId, d.url])).toEqual([
      [web.id, webPr!.url],
      [api.id, apiPr!.url],
    ])
    expect(diffs[0]!.files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['src/format/currency.ts', 'modified', 1, 1],
      ['src/shared/locale.ts', 'added', 1, 0],
    ])
    expect(diffs[0]!.head).toBe(`ticket-ac-${ticket.id}-currency-helper`)
    expect(diffs[0]!.base).toBe('main')
  })

  it('diffs the branch itself in a repo without a remote, where there is no PR', async () => {
    const { engine, git, web, ticketInReview } = setup({ webWithoutRemote: true })
    const ticket = await ticketInReview([web.id])
    const branch = `ticket-ac-${ticket.id}-currency-helper`
    git.setBranchDiff(branch, WEB_PATCH)

    const diffs = await engine.reviews.diff(ticket.id)

    expect(engine.code.of(ticket.id).pullRequests).toEqual([])
    expect(git.branchDiffs).toEqual([{ repoPath: onDisk('/code/web'), base: 'main', branch }])
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({
      repoId: web.id,
      url: null,
      refusal: { badge: 'No remote', reason: 'No remote, cannot open a PR' },
      head: branch,
      base: 'main',
    })
    expect(diffs[0]!.files.map((f) => f.path)).toEqual(['src/format/currency.ts', 'src/shared/locale.ts'])
  })

  it('diffs a ticket that has a branch but is not in Review yet, saying whether the repo has a remote', async () => {
    const { engine, git, web, ticketInDoing } = setup({ webWithoutRemote: true })
    const ticket = await ticketInDoing([web.id])
    const branch = `ticket-ac-${ticket.id}-currency-helper`
    git.setBranchDiff(branch, WEB_PATCH)

    const diffs = await engine.reviews.diff(ticket.id)

    expect(engine.board().snapshot().tickets[0]!.column).toBe('doing')
    expect(engine.code.of(ticket.id).pullRequests).toEqual([])
    expect(diffs).toMatchObject([
      { repoId: web.id, url: null, refusal: { badge: 'No remote' }, head: branch, base: 'main' },
    ])
    expect(diffs[0]!.files.map((f) => f.path)).toEqual(['src/format/currency.ts', 'src/shared/locale.ts'])
  })

  it('says nothing refuses a PR in a repo that can open one, PR or not', async () => {
    const { engine, git, web, ticketInDoing } = setup()
    const ticket = await ticketInDoing([web.id])
    git.setBranchDiff(`ticket-ac-${ticket.id}-currency-helper`, WEB_PATCH)

    expect(await engine.reviews.diff(ticket.id)).toMatchObject([{ repoId: web.id, refusal: null }])
  })

  it('says which forge it has no adapter for, in a repo that has a remote all the same', async () => {
    const { engine, git, web, ticketInDoing } = setup()
    git.withoutForge(onDisk('/code/web'), 'gitlab.example.com')
    const ticket = await ticketInDoing([web.id])
    git.setBranchDiff(`ticket-${ticket.id}-currency-helper`, WEB_PATCH)

    expect(await engine.reviews.diff(ticket.id)).toMatchObject([
      {
        repoId: web.id,
        url: null,
        refusal: { badge: 'No forge', reason: 'No adapter for gitlab.example.com, cannot open a PR' },
      },
    ])
  })

  /*
   * The change T243 made, and the one the boss felt: the patch used to be thrown away every fifteen
   * seconds, so every review event past that went back over the network to `gh`. It is now keyed by
   * the commit it is of, and a commit is what it is for ever — only a head that really moved costs
   * a read.
   */
  it('reads a patch once per head commit, however often the screen asks', async () => {
    let clock = 0
    const { engine, git, ticketInReview } = setup({ now: () => clock })
    const ticket = await ticketInReview()
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
    const branch = `ticket-ac-${ticket.id}-currency-helper`
    git.setRevision(branch, 'sha-one')

    await engine.reviews.diff(ticket.id)
    clock = 14_999
    await engine.reviews.diff(ticket.id)
    clock = 60_000
    await engine.reviews.diff(ticket.id)
    expect(git.diffsRead).toHaveLength(2)

    // The Employee pushes: the head is a different commit, and the patch is read again.
    git.setRevision(branch, 'sha-two')
    clock = 120_000
    await engine.reviews.diff(ticket.id)
    expect(git.diffsRead).toHaveLength(4)
  })

  describe('one file’s two sides', () => {
    it('reads the base at the merge base and the head at the branch', async () => {
      const { engine, git, web, ticketInReview } = setup()
      const ticket = await ticketInReview([web.id])
      await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
      const pr = engine.code.of(ticket.id).pullRequests[0]!
      git.setDiff(pr.url, WEB_PATCH)
      const branch = `ticket-ac-${ticket.id}-currency-helper`
      git.setRevision(`main...${branch}`, 'base-sha')
      git.setRevision(branch, 'head-sha')
      git.setFileAtRef('base-sha', 'src/format/currency.ts', 'return cents\n')
      git.setFileAtRef('head-sha', 'src/format/currency.ts', 'return cents / 100\n')

      const sides = await engine.reviews.fileSides({
        ticketId: ticket.id,
        repoId: web.id,
        path: 'src/format/currency.ts',
      })

      expect(sides).toEqual({
        path: 'src/format/currency.ts',
        original: 'return cents\n',
        modified: 'return cents / 100\n',
        binary: false,
      })
    })

    it('gives a file the change added no base side, and never asks for one', async () => {
      const { engine, git, web, ticketInReview } = setup()
      const ticket = await ticketInReview([web.id])
      await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
      git.setDiff(engine.code.of(ticket.id).pullRequests[0]!.url, WEB_PATCH)
      const branch = `ticket-ac-${ticket.id}-currency-helper`
      git.setRevision(branch, 'head-sha')
      git.setFileAtRef('head-sha', 'src/shared/locale.ts', "export const LOCALE = 'en-US'\n")

      const sides = await engine.reviews.fileSides({
        ticketId: ticket.id,
        repoId: web.id,
        path: 'src/shared/locale.ts',
      })

      expect(sides.original).toBe('')
      expect(sides.modified).toBe("export const LOCALE = 'en-US'\n")
      expect(git.filesRead).toEqual([{ ref: 'head-sha', path: 'src/shared/locale.ts' }])
    })

    it('refuses a path the change does not touch, rather than drawing an empty diff', async () => {
      const { engine, git, web, ticketInReview } = setup()
      const ticket = await ticketInReview([web.id])
      await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
      git.setDiff(engine.code.of(ticket.id).pullRequests[0]!.url, WEB_PATCH)

      await expect(
        engine.reviews.fileSides({ ticketId: ticket.id, repoId: web.id, path: 'src/nope.ts' }),
      ).rejects.toThrow('Nothing in this change touches src/nope.ts')
    })
  })

  it('leaves out a repo whose diff cannot be read', async () => {
    const { engine, git, api, ticketInReview } = setup()
    const ticket = await ticketInReview()
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
    const [webPr] = engine.code.of(ticket.id).pullRequests
    git.failDiff(webPr!.url, 'gh pr diff failed: not found')

    const diffs = await engine.reviews.diff(ticket.id)

    expect(diffs.map((d) => d.repoId)).toEqual([api.id])
  })

  it('reads a real repo without a remote: the worktree’s own commits, parsed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-diff-'))
    scratch.push(root)
    const repoPath = join(root, 'app')
    mkdirSync(repoPath)
    execFileSync('git', ['init', '--initial-branch=main', repoPath], { stdio: 'ignore' })
    writeFileSync(join(repoPath, 'currency.ts'), 'export function formatPrice(cents) {\n  return cents\n}\n')
    run(repoPath, 'add', '.')
    run(repoPath, 'commit', '-m', 'init')
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      git: createGitService(),
      log: () => {},
    })
    engines.push(engine)
    engine.createCompany({ folder: join(root, 'company'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const repo = engine.repos.add({ path: repoPath, name: 'app', stack: readyStack() })
    const ticket = engine.board().createTicket({ title: 'Currency', assigneeId: ada.id, repos: [repo.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).worktrees).toHaveLength(1))
    const worktree = engine.code.of(ticket.id).worktrees[0]!
    writeFileSync(join(worktree.path, 'currency.ts'), 'export function formatPrice(cents) {\n  return cents / 100\n}\n')
    writeFileSync(join(worktree.path, 'locale.ts'), "export const LOCALE = 'en-US'\n")
    run(worktree.path, 'add', '.')
    run(worktree.path, 'commit', '-m', 'format')
    engine.board().moveTicket(ticket.id, 'review')

    const diffs = await engine.reviews.diff(ticket.id)

    expect(engine.code.of(ticket.id).withoutPullRequest?.map((entry) => entry.repoId)).toEqual([repo.id])
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ repoId: repo.id, url: null, head: worktree.branch, base: 'main' })
    expect(diffs[0]!.files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['currency.ts', 'modified', 1, 1],
      ['locale.ts', 'added', 1, 0],
    ])

    // And the two sides the editor draws, read out of the same checkout.
    const sides = await engine.reviews.fileSides({ ticketId: ticket.id, repoId: repo.id, path: 'currency.ts' })
    expect(sides).toEqual({
      path: 'currency.ts',
      original: 'export function formatPrice(cents) {\n  return cents\n}\n',
      modified: 'export function formatPrice(cents) {\n  return cents / 100\n}\n',
      binary: false,
    })
  })
})
