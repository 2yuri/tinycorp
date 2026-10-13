import { describe, expect, it } from 'vitest'
import { createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'

/**
 * The worktree paths an Employee is told about, in its own runtime's spelling (T259).
 *
 * The sentence `brief` writes is the one that tells an Employee where to work — *work, commit and
 * push only in those directories* — so a `\\wsl.localhost\Arch\home\b\Acme\worktrees\t-4` in it names
 * a folder a Linux process cannot open. Its Session already *starts* in the right folder, because
 * `wslSpawnPty` translates the cwd (T167); this is about every path it reads afterwards.
 */
describe('the worktrees an Employee is told about', () => {
  function engineWith(providerRuntime?: () => { kind: 'wsl'; distro: string }) {
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      providers: { claude: fakeProvider() },
      isGitRepo: () => true,
      git: fakeGit(),
      mcpUrl: () => 'http://127.0.0.1/mcp',
      ...(providerRuntime && { providerRuntime }),
      log: () => {},
    })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web' })
    const ticket = engine.board().createTicket({ title: 'Login', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    return { engine, ticket, ada }
  }

  /** A git that makes a worktree inside a distro, which is what a Company folder in WSL produces. */
  function fakeGit() {
    return {
      addWorktree: ({ branch }: { branch: string }) => ({
        path: `\\\\wsl.localhost\\Arch\\home\\b\\Acme\\worktrees\\${branch}`,
        branch,
        base: 'main',
      }),
      hasRemote: () => false,
      forgeOf: () => null,
      pullRequestRefusal: () => null,
      canHoldReview: () => false,
      removeWorktree: () => Promise.resolve(),
    } as never
  }

  it('names them the way the distro does, for an Employee running in one', () => {
    const { engine, ticket } = engineWith(() => ({ kind: 'wsl', distro: 'Arch' }))

    const brief = engine.code.brief(ticket.id)

    expect(brief).toContain('/home/b/Acme/worktrees/')
    expect(brief).not.toContain('wsl.localhost')
  })

  it('names them the way this machine does when the Employee runs on it', () => {
    const { engine, ticket } = engineWith()

    expect(engine.code.brief(ticket.id)).toContain('wsl.localhost')
  })
})
