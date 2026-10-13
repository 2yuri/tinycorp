import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { RecentCompanies } from '../../core/recents'
import { inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { createGitService } from '../../platform/git-service'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { initialiseRepo } from '../repos'
import { READY_DELAY_MS } from '../sessions/sessions'
import { companyMoveTarget } from './company-move'

const engines: CompanyEngine[] = []
const dirs: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function scratch(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'tinycorp-move-')))
  dirs.push(dir)
  return dir
}

/** A new, existing folder named `name` in a scratch folder. */
function folderNamed(name: string): string {
  const dir = join(scratch(), name)
  mkdirSync(dir)
  return dir
}

function launch(recents: RecentCompanies = inMemoryRecents()): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    recents,
    providers: { claude: provider },
    isGitRepo: (path) => existsSync(join(path, '.git')),
    git: createGitService(),
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

describe('Moving a Company folder', () => {
  it('keeps its data, updates recents and restarts the Sessions that were running', () => {
    const recents = inMemoryRecents()
    const { engine, provider } = launch(recents)
    const from = folderNamed('acme')
    const acme = engine.createCompany({ folder: from, name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const grace = engine.employees.create({ name: 'Grace', roleId: 'backend' })
    engine.sessions.start(ada.id)
    provider.spawnOf(ada.id).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    engine.chat().post({ channelId: 'general', authorId: 'boss', text: 'Ship it' })
    mkdirSync(join(from, 'memory', ada.id), { recursive: true })
    writeFileSync(join(from, 'memory', ada.id, 'log'), 'I own the api\n')
    const to = join(scratch(), 'companies', 'acme')

    const moved = engine.moveCompany(acme.id, to)

    expect(moved).toMatchObject({ id: acme.id, name: 'Acme', folder: to })
    expect(existsSync(from)).toBe(false)
    expect(readFileSync(join(to, 'memory', ada.id, 'log'), 'utf8')).toBe('I own the api\n')
    expect(engine.currentCompany()).toMatchObject({ id: acme.id, folder: to })
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Ada', 'Grace'])
    expect(
      engine
        .chat()
        .read({ channelId: 'general' })
        .map((m) => m.text),
    ).toContain('Ship it')
    expect(recents.list()).toEqual([expect.objectContaining({ id: acme.id, folder: to })])
    expect(provider.spawns.map((s) => s.request.employee.id)).toEqual([ada.id, ada.id])
    expect(provider.spawns[0]!.pty.killed).toBe(true)
    expect(provider.spawns[1]!.request.resume).toBe(true)
    expect(engine.sessions.get(ada.id).status).toBe('starting')
    expect(engine.sessions.get(grace.id).status).toBe('off')
  })

  it('reads the moved database, not the closed one, from every per-Company cache', () => {
    const { engine } = launch()
    const from = folderNamed('acme')
    const acme = engine.createCompany({ folder: from, name: 'Acme' })
    // Touch the caches that hold the database, so each has an entry built on the old one.
    expect(engine.planning.list()).toEqual([])
    expect(engine.tests.list()).toEqual([])

    engine.moveCompany(acme.id, join(scratch(), 'companies', 'acme'))

    expect(() => engine.planning.list()).not.toThrow()
    expect(() => engine.tests.list()).not.toThrow()
  })

  it('moves into a picked folder that already holds files, under the Company folder’s name', () => {
    const { engine } = launch()
    const from = folderNamed('acme')
    const acme = engine.createCompany({ folder: from, name: 'Acme' })
    const picked = scratch()
    writeFileSync(join(picked, 'other.txt'), 'x')

    expect(engine.moveCompany(acme.id, picked).folder).toBe(join(picked, 'acme'))
    expect(existsSync(join(picked, 'acme', 'company.sqlite'))).toBe(true)
  })

  it('moves a Company that is not open and leaves the current one current', () => {
    const recents = inMemoryRecents()
    const { engine } = launch(recents)
    const acme = engine.createCompany({ folder: folderNamed('acme'), name: 'Acme' })
    engine.forgetCompany(acme.id)
    recents.remember(acme)
    const globex = engine.createCompany({ folder: folderNamed('globex'), name: 'Globex' })
    const to = join(scratch(), 'acme')

    engine.moveCompany(acme.id, to)

    expect(engine.currentCompany()?.id).toBe(globex.id)
    expect(recents.list().find((c) => c.id === acme.id)?.folder).toBe(to)
    expect(engine.switchCompany(acme.id).folder).toBe(to)
  })

  it('points repos and worktrees inside the folder at their new place, and git still finds them', () => {
    const { engine } = launch()
    const from = folderNamed('acme')
    const acme = engine.createCompany({ folder: from, name: 'Acme' })
    const app = join(from, 'app')
    mkdirSync(app)
    writeFileSync(join(app, 'README.md'), '# app\n')
    initialiseRepo(app, { author: 'Ada' })
    const repo = engine.repos.add({ path: app, stack: readyStack() })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const ticket = engine.board().createTicket({ title: 'Fix login', assigneeId: ada.id, repos: [repo.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    const [worktree] = engine.code.of(ticket.id).worktrees
    expect(worktree!.path.startsWith(join(from, 'worktrees') + sep)).toBe(true)
    const to = join(scratch(), 'moved')

    engine.moveCompany(acme.id, to)

    expect(engine.repos.list()[0]!.path).toBe(join(to, 'app'))
    const moved = engine.code.of(ticket.id).worktrees[0]!.path
    expect(moved).toBe(worktree!.path.replace(from, to))
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    expect(git(moved, 'status', '--porcelain')).toBe('')
    const listed = git(join(to, 'app'), 'worktree', 'list')
      .split('\n')
      .map((line) => resolve(line.split(' ')[0]!))
    expect(listed).toContain(resolve(moved))
  })

  it('refuses a folder inside the Company folder and a taken destination, leaving it open', () => {
    const { engine } = launch()
    const from = folderNamed('acme')
    const acme = engine.createCompany({ folder: from, name: 'Acme' })
    const picked = scratch()
    mkdirSync(join(picked, 'acme'))
    writeFileSync(join(picked, 'acme', 'x'), 'x')

    expect(() => engine.moveCompany(acme.id, join(from, 'inner'))).toThrow('cannot move inside its own folder')
    expect(() => engine.moveCompany(acme.id, picked)).toThrow('already exists')
    expect(engine.currentCompany()?.folder).toBe(from)
  })
})

describe('Move target', () => {
  it('is the picked folder when it is missing or empty', () => {
    const picked = scratch()
    expect(companyMoveTarget(onDisk('/work/acme'), picked)).toBe(picked)
    expect(companyMoveTarget(onDisk('/work/acme'), join(picked, 'new'))).toBe(join(picked, 'new'))
    expect(() => companyMoveTarget(onDisk('/work/acme'), 'relative')).toThrow('must be absolute')
  })
})
