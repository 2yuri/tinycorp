import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** The repo bullets of Ada's instructions, one line per repo. */
function repoLines() {
  const provider = fakeProvider()
  const git = fakeGit()
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
  const stack = readyStack()
  engine.repos.add({ path: onDisk('/code/merges'), name: 'merges-repo', stack })
  engine.repos.add({ path: onDisk('/code/pr'), name: 'pr-repo', stack, rung: 'pr' })
  engine.repos.add({ path: onDisk('/code/local'), name: 'local-repo', stack, rung: 'local' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

  engine.sessions.start(ada.id)

  const text = provider.spawnOf(ada.id).instructions!.text
  const line = (name: string) => text.split('\n').find((l) => l.includes(`**${name}**`))!
  return { text, line }
}

describe('Instructions about what TinyCorp may do to a repo', () => {
  it('tell an Employee a PR only repo is never merged, before it tries', () => {
    const { line } = repoLines()

    expect(line('pr-repo')).toContain(
      'This repo is PR only: push your branch and open the PR, and never merge it, with git or through the ' +
        'app. Asking to merge is refused, whatever the autonomy level says.',
    )
  })

  it('tell an Employee a local only repo is never pushed from', () => {
    const { line } = repoLines()

    expect(line('local-repo')).toContain(
      'This repo is local only: never push from it and never merge in it. Work and commit in your worktree ' +
        'and leave it there; moving the ticket to Review opens no PR',
    )
  })

  it('say nothing on a repo that may merge, so nothing changes for a Company that never touches this', () => {
    const { line } = repoLines()

    expect(line('merges-repo')).not.toContain('This repo is')
  })

  it('say the repo beats the autonomy level, once, in the Repos section', () => {
    const { text } = repoLines()

    expect(text).toContain('What a repo says TinyCorp may do to it beats the autonomy level')
  })
})
