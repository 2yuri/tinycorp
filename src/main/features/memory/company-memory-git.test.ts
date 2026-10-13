import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate } from '../../core/engine/migrations'
import { removeFolder } from '../../core/testing'
import { createCompanyMemory } from './company-memory'
import { memoryPageFilesOnDisk } from './company-memory-files'
import { createMemoryGit } from './company-memory-git'
import { companyMemoryFolder } from './company-memory-page'

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) removeFolder(dir)
})

/** A Company memory on a real folder, with a real git repo under it. */
function onDisk() {
  const root = mkdtempSync(join(tmpdir(), 'company-memory-'))
  scratch.push(root)
  const folder = companyMemoryFolder(root)
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const files = memoryPageFilesOnDisk(folder)
  const memory = createCompanyMemory({ db, files, git: createMemoryGit() })
  return { root, folder, memory }
}

function log(folder: string, format: string): string[] {
  return execFileSync('git', ['log', `--format=${format}`], { cwd: folder, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((line) => line !== '')
}

describe('the memory folder is its own git repo', () => {
  it('commits every write with the author who made it', () => {
    const { folder, memory } = onDisk()
    expect(existsSync(join(folder, '.git'))).toBe(true)

    memory.write({ kind: 'decision', title: 'Locale handling in billing', body: 'Minor units.', by: 'Vega' })
    memory.write({ kind: 'decision', title: 'Locale handling in billing', body: 'And the fallback.', by: 'Yuri' })

    expect(log(folder, '%an')).toEqual(['Yuri', 'Vega'])
    expect(log(folder, '%s')).toEqual([
      'Update decision locale-handling-in-billing',
      'Add decision locale-handling-in-billing',
    ])
    // A commit that names nobody would be the app's, not the Employee's — the point of git here.
    expect(log(folder, '%ae')).toEqual(['yuri@tinycorp.local', 'vega@tinycorp.local'])
  })

  it('gives History and puts a page back to what a commit had', () => {
    const { memory } = onDisk()
    memory.write({ kind: 'gotcha', title: 'Vitest hangs at 90%', body: 'First reading.', by: 'Nova' })
    memory.write({
      kind: 'gotcha',
      title: 'Vitest hangs at 90%',
      body: 'Wrong: it was the sandbox.',
      mode: 'replace',
      by: 'Iris',
    })

    const history = memory.history('vitest-hangs-at-90')
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ author: 'Iris' })
    expect(history[1]).toMatchObject({ author: 'Nova' })
    expect(memory.get('vitest-hangs-at-90')?.body).toBe('Wrong: it was the sandbox.')

    const restored = memory.restore('vitest-hangs-at-90', history[1]!.commit, 'Yuri')
    expect(restored.body).toBe('First reading.')
    expect(memory.history('vitest-hangs-at-90')[0]).toMatchObject({ author: 'Yuri' })
  })

  it('keeps an archived page: the file moves, git still has it', () => {
    const { folder, memory } = onDisk()
    memory.write({ kind: 'decision', title: 'Legacy invoice PDF renderer', body: 'Still there.', by: 'Orion' })
    memory.archive('legacy-invoice-pdf-renderer', 'Yuri')

    expect(existsSync(join(folder, 'decisions', 'legacy-invoice-pdf-renderer.md'))).toBe(false)
    expect(existsSync(join(folder, 'archive', 'legacy-invoice-pdf-renderer.md'))).toBe(true)
    expect(memory.history('legacy-invoice-pdf-renderer').map((revision) => revision.author)).toEqual(['Yuri', 'Orion'])
  })

  it('names a page the same way on every platform, whatever the separator here is', () => {
    const { folder, memory } = onDisk()
    memory.write({ kind: 'convention', title: 'Every price goes through formatPrice', body: 'Always.', by: 'Orion' })
    const files = memoryPageFilesOnDisk(folder)

    // The key is POSIX wherever it runs — it is what the index holds and what git is given — while
    // the file it stands for is a path this platform wrote with its own separator.
    expect(files.list()).toContain('conventions/every-price-goes-through-formatprice.md')
    expect(files.list().every((name) => !name.includes(sep === '/' ? '\\' : sep))).toBe(true)
    expect(files.read('conventions/every-price-goes-through-formatprice.md')).toContain('Always.')
    expect(existsSync(join(folder, 'conventions', 'every-price-goes-through-formatprice.md'))).toBe(true)
    // And git, asked with that same key, knows the file.
    expect(memory.history('every-price-goes-through-formatprice')).toHaveLength(1)
  })

  it('rebuilds the index from the folder alone', () => {
    const { folder, memory } = onDisk()
    memory.write({ kind: 'convention', title: 'Every price goes through formatPrice', body: 'Always.', by: 'Orion' })
    memory.write({ kind: 'glossary', title: 'Seat vs member', body: 'A seat is billed.', by: 'Nova' })
    expect(memory.rebuild()).toMatchObject({ pages: 2 })
    expect(existsSync(join(folder, 'conventions', 'every-price-goes-through-formatprice.md'))).toBe(true)
  })
})

describe('A new Company', () => {
  it('makes its memory repo even though the folder does not exist yet, so the first page is a commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'company-memory-new-'))
    scratch.push(root)
    const folder = companyMemoryFolder(root)
    expect(existsSync(folder)).toBe(false)
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const memory = createCompanyMemory({ db, files: memoryPageFilesOnDisk(folder), git: createMemoryGit() })

    memory.write({ kind: 'decision', title: 'First page', body: 'Say the thing.', by: 'Yuri' })

    expect(existsSync(join(folder, '.git'))).toBe(true)
    expect(log(folder, '%an %s')).toEqual(['Yuri Add decision first-page'])
  })
})

/**
 * The Company memory is a git repo in the Company folder, and since T256 that folder can be inside a
 * WSL distro. Git for Windows reads every file under `\\wsl.localhost\…` as owned by a Linux uid it
 * has never heard of and refuses the repo outright — *detected dubious ownership*. Since T259 there
 * is a better answer than naming the folder as safe: a wiki inside a distro is committed by **that
 * distro's own git**, which is simply the owner there.
 *
 * Which git that is, and what `-c` goes in front of it, is `git-runner.ts`'s and is pinned in
 * `git-runner.test.ts`. What is this module's own is that it hands the runner the **folder**, so the
 * decision can be made from it at all — and that it adds no settings of its own, because two places
 * deciding the same thing is how the `safe.directory` this file used to carry went out of date.
 */
describe('the memory wiki’s git and the folder it is asked about', () => {
  function recording() {
    const root = mkdtempSync(join(tmpdir(), 'company-memory-runner-'))
    scratch.push(root)
    const folder = companyMemoryFolder(root)
    mkdirSync(folder, { recursive: true })
    const asked: { cwd: string; args: string[] }[] = []
    const git = createMemoryGit({
      git: {
        text: () => '',
        tryText: (cwd, args) => {
          asked.push({ cwd, args: [...args] })
          return ''
        },
        output: () => Promise.resolve(''),
        settings: () => [],
        runtimeFor: () => ({ kind: 'windows' }),
        toHost: (_cwd, path) => path,
      },
    })
    return { git, asked, folder }
  }

  it('asks about the Company folder itself, so which git owns it can be read off it', () => {
    const { git, asked, folder } = recording()

    git.history(folder, 'decisions/x.md')
    git.show(folder, 'HEAD', 'decisions/x.md')

    expect(asked).not.toEqual([])
    for (const call of asked) expect(call.cwd).toBe(realpathSync.native(folder))
  })

  it('puts no `-c` of its own in front of a command: every setting is the runner’s to decide', () => {
    const { git, asked, folder } = recording()

    git.history(folder, 'decisions/x.md')

    expect(asked[0]!.args[0]).toBe('log')
  })
})
