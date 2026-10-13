import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { worktreeRootOf } from '../features/code'
import { initialiseRepo } from '../features/repos'
import { createGitService } from '../platform/git-service'
import { companyDataIgnores, ignoreCompanyData } from './company-data-ignore'
import { type CompanyEngine, createCompanyEngine } from './engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from './testing'

const scratch: string[] = []
const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'company-data-')))
  scratch.push(dir)
  return dir
}

/** A Company folder with every kind of Company data in it, as the engine leaves it. */
function companyData(folder: string): void {
  mkdirSync(join(folder, 'memory'), { recursive: true })
  mkdirSync(join(folder, 'attachments'), { recursive: true })
  mkdirSync(join(folder, 'worktrees', 'app'), { recursive: true })
  mkdirSync(join(folder, 'restore-points'), { recursive: true })
  writeFileSync(join(folder, 'company.sqlite'), 'db')
  writeFileSync(join(folder, 'company.sqlite-wal'), 'wal')
  writeFileSync(join(folder, 'memory', 'e1.md'), '# memory\n')
  writeFileSync(join(folder, 'attachments', 'shot.png'), 'png')
  writeFileSync(join(folder, 'worktrees', 'app', 'file.txt'), 'x')
  writeFileSync(join(folder, 'restore-points', 'p1.tree.patch'), 'patch')
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const ANCHORED = [
  '/company.sqlite*',
  '/.tinycorp/',
  '/memory/',
  '/worktrees/',
  '/attachments/',
  '/testing/',
  '/restore-points/',
]

describe('Company data ignore lines', () => {
  it('anchors the data to the repo root when the repo is the Company folder', () => {
    const folder = root()
    expect(companyDataIgnores(folder, folder)).toEqual(ANCHORED)
  })

  it('anchors the data under the Company folder when the repo contains it', () => {
    const repo = root()
    expect(companyDataIgnores(repo, join(repo, 'ops', 'company'))).toEqual(
      ANCHORED.map((line) => `/ops/company${line}`),
    )
  })

  it('has nothing to ignore when the repo is inside or beside the Company folder', () => {
    const company = root()
    expect(companyDataIgnores(join(company, 'app'), company)).toEqual([])
    expect(companyDataIgnores(join(company, '..', 'elsewhere'), company)).toEqual([])
  })
})

describe('Initialise keeps Company data out of the repo', () => {
  it('ignores and never commits the data when the repo is the Company folder', () => {
    const folder = root()
    companyData(folder)
    writeFileSync(join(folder, 'README.md'), '# app\n')

    initialiseRepo(folder, { author: 'Ada', companyFolders: [folder] })

    expect(git(folder, 'ls-files').split('\n').sort()).toEqual(['.gitignore', 'README.md'])
    expect(readFileSync(join(folder, '.gitignore'), 'utf8')).toContain(ANCHORED.join('\n'))
    expect(git(folder, 'status', '--porcelain')).toBe('')
  })

  it('ignores the data of a Company folder inside the repo, next to the stack ignores', () => {
    const repo = root()
    const company = join(repo, 'company')
    companyData(company)
    writeFileSync(join(repo, 'package.json'), '{}')
    writeFileSync(join(repo, 'tsconfig.json'), '{}')
    writeFileSync(join(company, 'notes.md'), 'kept\n')

    initialiseRepo(repo, { author: 'Ada', companyFolders: [company] })

    const ignore = readFileSync(join(repo, '.gitignore'), 'utf8')
    expect(ignore).toContain('node_modules/')
    expect(ignore).toContain('/company/company.sqlite*')
    expect(git(repo, 'ls-files').split('\n').sort()).toEqual([
      '.gitignore',
      'company/notes.md',
      'package.json',
      'tsconfig.json',
    ])
  })

  it('writes nothing extra for a repo unrelated to any Company', () => {
    const company = root()
    const repo = join(root(), 'app')
    mkdirSync(repo)
    writeFileSync(join(repo, 'README.md'), '# app\n')

    initialiseRepo(repo, { author: 'Ada', companyFolders: [company] })

    expect(git(repo, 'ls-files')).toBe('README.md')
  })
})

describe('Attach adds the ignore lines', () => {
  it('appends the lines once, keeping what the .gitignore had', () => {
    const folder = root()
    writeFileSync(join(folder, '.gitignore'), 'node_modules/')

    expect(ignoreCompanyData(folder, [folder])).toEqual(ANCHORED)
    expect(ignoreCompanyData(folder, [folder, folder])).toEqual([])

    const ignore = readFileSync(join(folder, '.gitignore'), 'utf8')
    expect(ignore).toBe(`node_modules/\n\n# tinycorp Company data\n${ANCHORED.join('\n')}\n`)
  })

  it('only adds the lines that are missing', () => {
    const folder = root()
    writeFileSync(join(folder, '.gitignore'), '/memory/\n')

    expect(ignoreCompanyData(folder, [folder])).toEqual([
      '/company.sqlite*',
      '/.tinycorp/',
      '/worktrees/',
      '/attachments/',
      '/testing/',
      '/restore-points/',
    ])
  })

  it('leaves a repo unrelated to the Company, or missing from disk, untouched', () => {
    const company = root()
    const repo = root()

    expect(ignoreCompanyData(repo, [company])).toEqual([])
    expect(ignoreCompanyData(join(repo, 'gone'), [repo])).toEqual([])
    expect(() => readFileSync(join(repo, '.gitignore'))).toThrow()
  })
})

describe('Attaching a repo in the engine', () => {
  function engineWithCompany(folder: string): CompanyEngine {
    const engine = createCompanyEngine({
      recents: inMemoryRecents(),
      openDatabase: inMemoryDatabases(),
      isGitRepo: () => true,
    })
    engines.push(engine)
    engine.createCompany({ folder, name: 'Acme' })
    return engine
  }

  it('ignores the Company data when the attached repo is the Company folder', () => {
    const folder = root()
    const engine = engineWithCompany(folder)

    engine.repos.add({ path: folder })

    expect(readFileSync(join(folder, '.gitignore'), 'utf8')).toContain(ANCHORED.join('\n'))
  })

  it('ignores the Company data when the attached repo contains the Company folder', () => {
    const repo = root()
    const engine = engineWithCompany(join(repo, 'acme'))

    engine.repos.add({ path: repo })

    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toContain('/acme/memory/')
  })

  it('writes no .gitignore into a repo inside the Company folder', () => {
    const company = root()
    const repo = join(company, 'app')
    mkdirSync(repo)
    const engine = engineWithCompany(company)

    engine.repos.add({ path: repo })

    expect(() => readFileSync(join(repo, '.gitignore'))).toThrow()
  })
})

describe('Worktrees never go inside the repo', () => {
  it('keeps them in the Company folder for a repo elsewhere on the same filesystem', () => {
    expect(worktreeRootOf(onDisk('/work/acme'), { id: 'r1', name: 'App', path: onDisk('/code/app') })).toBe(
      onDisk('/work/acme/worktrees/app'),
    )
  })

  it('puts them beside a repo that is the Company folder', () => {
    expect(worktreeRootOf(onDisk('/work/acme'), { id: 'r1', name: 'App', path: onDisk('/work/acme') })).toBe(
      onDisk('/work/acme-worktrees'),
    )
  })

  it('creates a real worktree outside a repo that contains the Company folder', () => {
    const repo = root()
    writeFileSync(join(repo, 'README.md'), '# app\n')
    initialiseRepo(repo, { author: 'Ada', companyFolders: [join(repo, 'company')] })
    const path = join(worktreeRootOf(join(repo, 'company'), { id: 'r1', name: 'app', path: repo }), 'ticket-1')
    scratch.push(`${repo}-worktrees`)

    createGitService().addWorktree({ repoPath: repo, path, branch: 'ticket-1' })

    expect(path.startsWith(`${repo}-worktrees${sep}`)).toBe(true)
    expect(git(path, 'branch', '--show-current')).toBe('ticket-1')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })
})

/**
 * A repo inside a WSL distro is one Windows reaches over `\\wsl.localhost\<distro>\…`, and the
 * Company folder cannot be there at all (T252). The paths here are written as Windows writes them
 * rather than through `onDisk`, because a UNC path is a Windows path and has no POSIX spelling —
 * which is the whole reason `worktreeRootOf` reads the shape of the path rather than the platform,
 * so these say the same thing on all three runners (T255).
 */
describe("Worktrees stay on the repo's own filesystem", () => {
  const wslRepo = '\\\\wsl.localhost\\Arch\\home\\b\\app'

  it('puts them beside a repo in WSL when the Company folder is on a drive', () => {
    expect(worktreeRootOf('C:\\Users\\b\\TinyCorp\\Acme', { id: 'r1', name: 'App', path: wslRepo })).toBe(
      '\\\\wsl.localhost\\Arch\\home\\b\\app-worktrees',
    )
  })

  // Both of these are under the Company folder, which is all the rule decides; the separator
  // between it and `worktrees` is the runner's, so only the folder it starts from is asserted.
  it('keeps them under the Company folder for a repo on another drive of the PC', () => {
    const company = 'C:\\Users\\b\\TinyCorp\\Acme'

    const root = worktreeRootOf(company, { id: 'r1', name: 'App', path: 'D:\\code\\app' })

    expect(root.startsWith(company)).toBe(true)
    expect(root.endsWith('app')).toBe(true)
  })

  it('keeps them under a Company folder that is in WSL too, where they are already in the distro', () => {
    const company = '\\\\wsl.localhost\\Arch\\home\\b\\TinyCorp\\Acme'

    const root = worktreeRootOf(company, { id: 'r1', name: 'App', path: wslRepo })

    expect(root.startsWith(company)).toBe(true)
  })

  it('keeps a POSIX repo and Company folder exactly as they were', () => {
    expect(worktreeRootOf(onDisk('/work/acme'), { id: 'r1', name: 'App', path: onDisk('/code/app') })).toBe(
      onDisk('/work/acme/worktrees/app'),
    )
  })
})
