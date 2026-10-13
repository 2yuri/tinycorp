import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChangedFile } from '../../../shared/files/file-changes'
import { type FilePlace, placeId } from '../../../shared/files/files'
import { onDisk } from '../../core/testing'
import { type ChangesGit, createFileChanges, gitChanges, parseStatus } from './file-changes'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A real repo on disk: the parsing is git's own output, never a string a test made up. */
function repo(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-changes-'))
  folders.push(folder)
  git(folder, ['init', '--quiet', '--initial-branch=main', '.'])
  git(folder, ['config', 'user.email', 'boss@tinycorp.test'])
  git(folder, ['config', 'user.name', 'The Boss'])
  git(folder, ['config', 'commit.gpgsign', 'false'])
  return folder
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function write(folder: string, path: string, text: string): void {
  mkdirSync(join(folder, path, '..'), { recursive: true })
  writeFileSync(join(folder, path), text)
}

function place(path: string, extra: Partial<FilePlace> = {}): FilePlace {
  return {
    id: placeId('r-web', 142),
    repoId: 'r-web',
    repoName: 'web-app',
    path,
    ticketId: 142,
    ticketKey: 'TC-142',
    ticketTitle: 'the counter speaks',
    holderName: 'Ada',
    branch: 'ticket-tc-142-usage-chart',
    base: 'main',
    sessionRunning: false,
    ...extra,
  }
}

describe('What git says about a place', () => {
  it('keeps the index and the working tree apart, and marks each side', () => {
    const folder = repo()
    write(folder, 'kept.ts', 'one\n')
    write(folder, 'gone.ts', 'two\n')
    write(folder, 'old.ts', 'three\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    write(folder, 'kept.ts', 'one\nstaged\n')
    git(folder, ['add', 'kept.ts'])
    write(folder, 'kept.ts', 'one\nstaged\nand more\n')
    rmSync(join(folder, 'gone.ts'))
    git(folder, ['mv', 'old.ts', 'new.ts'])
    write(folder, 'fresh.ts', 'four\n')

    const { files, branch } = parseStatus(gitChanges.status(folder)!)

    expect(branch).toBe('main')
    expect(byPath(files, 'kept.ts')).toMatchObject({ staged: 'modified', unstaged: 'modified' })
    expect(byPath(files, 'gone.ts')).toMatchObject({ staged: null, unstaged: 'removed' })
    expect(byPath(files, 'new.ts')).toMatchObject({ staged: 'renamed', previousPath: 'old.ts' })
    expect(byPath(files, 'fresh.ts')).toMatchObject({ staged: null, unstaged: 'added' })
  })

  it('reads a branch with an upstream, and how far ahead of it the place is', () => {
    expect(parseStatus('## main...origin/main [ahead 2, behind 1]\0')).toMatchObject({
      branch: 'main',
      ahead: 2,
      upstream: true,
    })
    expect(parseStatus('## main\0')).toMatchObject({ branch: 'main', ahead: 0, upstream: false })
    expect(parseStatus('## No commits yet on main\0')).toMatchObject({ branch: 'main', upstream: false })
  })

  it('calls a file both sides touched conflicted, and neither staged nor changed', () => {
    const { files } = parseStatus('## main\0UU merged.ts\0')

    expect(files[0]).toMatchObject({ path: 'merged.ts', conflicted: true, staged: null })
  })

  it('stops at its limit rather than listing a folder nobody meant to add', () => {
    const many = ['## main', ...Array.from({ length: 10 }, (_, n) => `?? file-${n}.ts`)].join('\0') + '\0'

    expect(parseStatus(many, 4)).toMatchObject({ truncated: true })
    expect(parseStatus(many, 4).files).toHaveLength(4)
  })
})

describe('The reader over the Company’s places', () => {
  it('leaves out a place with nothing changed, rather than showing it empty', () => {
    const folder = repo()
    write(folder, 'a.ts', 'one\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    const changes = createFileChanges({ places: () => [place(folder)] })

    expect(changes.list()).toEqual([])

    write(folder, 'a.ts', 'two\n')
    changes.invalidate()

    expect(changes.list()).toHaveLength(1)
  })

  it('leaves out a worktree whose folder has gone, which is not an error', () => {
    const changes = createFileChanges({ places: () => [place(onDisk('/nowhere/at/all'))] })

    expect(changes.list()).toEqual([])
  })

  it('asks git once per place until something says it moved', () => {
    let asked = 0
    const changes = createFileChanges({
      places: () => [place('/anywhere')],
      git: { ...refuses, status: () => (asked++, '## main\0 M a.ts\0') },
    })

    changes.list()
    changes.list()
    expect(asked).toBe(1)

    changes.invalidate()
    changes.list()
    expect(asked).toBe(2)
  })

  it('counts every changed file of every place, so the tab matches the rows', () => {
    const one = repo()
    const two = repo()
    for (const folder of [one, two]) {
      write(folder, 'a.ts', 'one\n')
      git(folder, ['add', '-A'])
      git(folder, ['commit', '--quiet', '-m', 'first'])
    }
    write(one, 'a.ts', 'two\n')
    write(one, 'b.ts', 'new\n')
    write(two, 'a.ts', 'two\n')
    const changes = createFileChanges({
      places: () => [place(one), place(two, { id: 'repo:r-two', ticketId: null, branch: null })],
    })

    expect(changes.list().flatMap((one) => one.files)).toHaveLength(3)
  })
})

describe('The five actions', () => {
  it('stages, unstages, commits and leaves the place clean', () => {
    const folder = repo()
    write(folder, 'a.ts', 'one\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    write(folder, 'a.ts', 'two\n')
    const changes = createFileChanges({ places: () => [place(folder)] })
    const id = place(folder).id

    changes.stage(id, ['a.ts'])
    expect(changes.of(id).files[0]).toMatchObject({ staged: 'modified', unstaged: null })

    changes.unstage(id, ['a.ts'])
    expect(changes.of(id).files[0]).toMatchObject({ staged: null, unstaged: 'modified' })

    changes.stage(id, ['a.ts'])
    changes.commit(id, 'the counter speaks')
    expect(changes.of(id).files).toEqual([])
    expect(git(folder, ['log', '-1', '--format=%s']).trim()).toBe('the counter speaks')
  })

  it('refuses a commit with nothing staged rather than committing the whole tree', () => {
    const folder = repo()
    write(folder, 'a.ts', 'one\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    write(folder, 'a.ts', 'two\n')
    const changes = createFileChanges({ places: () => [place(folder)] })

    expect(() => changes.commit(place(folder).id, 'nothing to see')).toThrow(/Nothing is staged/)
    expect(git(folder, ['log', '--format=%s']).trim()).toBe('first')
  })

  it('discards a modification back to HEAD and deletes a file HEAD never had', () => {
    const folder = repo()
    write(folder, 'kept.ts', 'one\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    write(folder, 'kept.ts', 'one\nand more\n')
    write(folder, 'fresh.ts', 'new\n')
    const changes = createFileChanges({ places: () => [place(folder)] })
    const id = place(folder).id

    changes.discard(id, ['kept.ts', 'fresh.ts'])

    expect(changes.of(id).files).toEqual([])
    expect(git(folder, ['show', 'HEAD:kept.ts'])).toBe('one\n')
  })

  it('undoes a rename from both of its names', () => {
    const folder = repo()
    write(folder, 'old.ts', 'one\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    git(folder, ['mv', 'old.ts', 'new.ts'])
    const changes = createFileChanges({ places: () => [place(folder)] })
    const id = place(folder).id

    changes.discard(id, ['new.ts'])

    expect(changes.of(id).files).toEqual([])
  })
})

describe('The diff beside the list', () => {
  it('gives a modified file its hunks, numbered on the side they exist on', () => {
    const folder = repo()
    write(folder, 'a.ts', 'one\ntwo\nthree\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    write(folder, 'a.ts', 'one\nTWO\nthree\n')
    const changes = createFileChanges({ places: () => [place(folder)] })

    const diff = changes.diff(place(folder).id, 'a.ts')

    expect(diff?.file).toMatchObject({ path: 'a.ts', status: 'modified', additions: 1, deletions: 1 })
    // The two sides, whole: the editor works the change out of them itself (T243).
    expect(diff?.sides).toEqual({
      path: 'a.ts',
      original: 'one\ntwo\nthree\n',
      modified: 'one\nTWO\nthree\n',
      binary: false,
    })
  })

  it('gives a file git has never seen its whole text, which `git diff` alone has none of', () => {
    const folder = repo()
    write(folder, 'a.ts', 'one\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    write(folder, 'fresh.ts', 'new\nand newer\n')
    const changes = createFileChanges({ places: () => [place(folder)] })

    const diff = changes.diff(place(folder).id, 'fresh.ts')

    expect(diff?.file.path).toBe('fresh.ts')
    // HEAD has never had it, so there is no base side to read and none is asked for.
    expect(diff?.sides).toEqual({ path: 'fresh.ts', original: '', modified: 'new\nand newer\n', binary: false })
  })

  it('says a binary file has nothing to show rather than drawing its bytes', () => {
    const folder = repo()
    writeFileSync(join(folder, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    writeFileSync(join(folder, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03, 0x04, 0x05]))
    const changes = createFileChanges({ places: () => [place(folder)] })

    const diff = changes.diff(place(folder).id, 'logo.png')

    expect(diff?.file.binary).toBe(true)
    expect(diff?.sides).toEqual({ path: 'logo.png', original: '', modified: '', binary: true })
  })

  it('gives a deleted file the removal of every line it had', () => {
    const folder = repo()
    write(folder, 'gone.ts', 'one\ntwo\n')
    git(folder, ['add', '-A'])
    git(folder, ['commit', '--quiet', '-m', 'first'])
    rmSync(join(folder, 'gone.ts'))
    const changes = createFileChanges({ places: () => [place(folder)] })

    const diff = changes.diff(place(folder).id, 'gone.ts')

    expect(diff?.file.status).toBe('removed')
    expect(diff?.sides).toEqual({ path: 'gone.ts', original: 'one\ntwo\n', modified: '', binary: false })
  })
})

function byPath(files: readonly ChangedFile[], path: string): ChangedFile | undefined {
  return files.find((file) => file.path === path)
}

/** A git that would fail the test if it were reached: each case names the one call it allows. */
const refuses: ChangesGit = {
  status: () => {
    throw new Error('not asked for')
  },
  diff: () => {
    throw new Error('not asked for')
  },
  atHead: () => {
    throw new Error('not asked for')
  },
  working: () => {
    throw new Error('not asked for')
  },
  stage: () => {
    throw new Error('not asked for')
  },
  unstage: () => {
    throw new Error('not asked for')
  },
  discard: () => {
    throw new Error('not asked for')
  },
  commit: () => {
    throw new Error('not asked for')
  },
  push: () => {
    throw new Error('not asked for')
  },
}
