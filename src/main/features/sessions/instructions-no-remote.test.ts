import { afterEach, describe, expect, it } from 'vitest'
import { NO_REMOTE } from '../../../shared/code'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** Everything an Employee is told about a repo it cannot open a pull request in. */
describe('Instructions about a repo without a remote', () => {
  it('tell Employees no PR can be opened there, and say nothing for repos with one', () => {
    const provider = fakeProvider()
    const git = fakeGit()
    git.withoutRemote(onDisk('/code/notes'))
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      providers: { claude: provider },
      isGitRepo: () => true,
      git,
    })
    provider.connect(engine.sessions.receiveHook)
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    engine.repos.add({ path: onDisk('/code/notes'), name: 'notes', stack: readyStack() })
    engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    const lines = provider.spawnOf(ada.id).instructions!.text.split('\n')
    const notes = lines.find((line) => line.includes('**notes**'))!
    const api = lines.find((line) => line.includes('**api**'))!
    expect(notes).toContain(
      `${NO_REMOTE} here: worktrees and branches work, but moving a ticket to Review opens no PR until the boss adds an origin remote. When the work is ready, move the ticket to Review and ask to merge with \`approval_request\` (action "merge"); once the boss approves, the app merges it into the base branch.`,
    )
    expect(api).not.toContain(NO_REMOTE)
  })

  it('tell Employees, in a repo on a forge with no adapter, that the PR is the boss’s to open', () => {
    const provider = fakeProvider()
    const git = fakeGit()
    git.withoutForge(onDisk('/code/infra'), 'gitlab.example.com')
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      providers: { claude: provider },
      isGitRepo: () => true,
      git,
    })
    provider.connect(engine.sessions.receiveHook)
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    engine.repos.add({ path: onDisk('/code/infra'), name: 'infra', stack: readyStack() })
    engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    const lines = provider.spawnOf(ada.id).instructions!.text.split('\n')
    const infra = lines.find((line) => line.includes('**infra**'))!
    expect(infra).toContain(
      'No adapter for gitlab.example.com, cannot open a PR here: worktrees, branches and diffs all work, and ' +
        'your commits stay on the ticket’s branch. When the work is ready, move the ticket to Review and say so ' +
        'in `#prs` — the boss pushes the branch and opens the pull request. Never push or merge it yourself.',
    )
    // It is not the no-remote rule: this repo has an origin, and nothing here is merged locally.
    expect(infra).not.toContain('adds an origin remote')
  })
})
