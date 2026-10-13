import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Worktree } from '../../../shared/code'
import { type FilePlace, placeId, placeLabel, sizeLabel } from '../../../shared/files/files'
import { onDisk } from '../../core/testing'
import {
  changedLinesOf,
  changesOfNameStatus,
  createFiles,
  filePlaces,
  HEAD_BYTES,
  resolveInside,
  TOO_BIG_BYTES,
} from './files'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-files-'))
  folders.push(folder)
  return folder
}

function place(path: string, extra: Partial<FilePlace> = {}): FilePlace {
  return {
    id: placeId('r-web', null),
    repoId: 'r-web',
    repoName: 'tinycorp',
    path,
    ticketId: null,
    ticketKey: null,
    ticketTitle: null,
    holderName: null,
    branch: null,
    base: null,
    sessionRunning: false,
    ...extra,
  }
}

const worktreePlace = (path: string) =>
  place(path, {
    id: placeId('r-web', 142),
    ticketId: 142,
    ticketKey: 'TC-142',
    ticketTitle: 'the counter speaks',
    holderName: 'Ada',
    branch: 'ticket-142-the-counter-speaks',
    base: 'main',
  })

const noGit = { changes: () => ({}), changedLines: () => [] }

describe('Where the Files view may read', () => {
  it('reads a source file inside a repo as code, with its language and lines', () => {
    const root = temporary()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/counter.ts'), 'export const one = 1\nexport const two = 2\n')
    const files = createFiles({ places: () => [place(root)], deps: noGit })

    const opened = files.open(placeId('r-web', null), 'src/counter.ts')

    expect(opened).toMatchObject({
      path: 'src/counter.ts',
      kind: 'code',
      language: 'ts',
      truncated: false,
      lines: 2,
      changedLines: [],
    })
    expect(opened.text).toContain('export const two = 2')
  })

  it('refuses a path that climbs out of the place, however it is written', () => {
    const root = temporary()
    mkdirSync(join(root, 'inside'))
    writeFileSync(join(root, 'inside/ok.txt'), 'fine')
    writeFileSync(join(root, 'secret.txt'), 'not for the renderer')
    const files = createFiles({ places: () => [place(join(root, 'inside'))], deps: noGit })

    expect(() => files.open(placeId('r-web', null), '../secret.txt')).toThrow(/outside/)
    expect(() => files.open(placeId('r-web', null), join(root, 'secret.txt'))).toThrow(/outside/)
    expect(() => files.locate(placeId('r-web', null), '../secret.txt')).toThrow(/outside/)
    expect(files.open(placeId('r-web', null), 'ok.txt').text).toBe('fine')
  })

  it('refuses a symlink that points out of the place', () => {
    const root = temporary()
    mkdirSync(join(root, 'inside'))
    writeFileSync(join(root, 'secret.txt'), 'not for the renderer')
    symlinkSync(join(root, 'secret.txt'), join(root, 'inside/escape.txt'))
    const files = createFiles({ places: () => [place(join(root, 'inside'))], deps: noGit })

    expect(() => files.open(placeId('r-web', null), 'escape.txt')).toThrow(/outside/)
  })

  it('refuses a place it does not know', () => {
    const files = createFiles({ places: () => [], deps: noGit })

    expect(() => files.open('worktree:9:r-none', 'a.ts')).toThrow(/no repo or worktree/i)
  })
})

describe('Opening a file by its kind', () => {
  it('says a binary file is binary rather than showing it', () => {
    const root = temporary()
    writeFileSync(join(root, 'app.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]))
    const files = createFiles({ places: () => [place(root)], deps: noGit })

    expect(files.open(placeId('r-web', null), 'app.bin')).toMatchObject({
      kind: 'binary',
      text: null,
      size: 7,
    })
  })

  it('reads a bounded head of a big file and reports the real size', () => {
    const root = temporary()
    const whole = 'x'.repeat(HEAD_BYTES + 5000)
    writeFileSync(join(root, 'huge.log'), whole)
    const files = createFiles({ places: () => [place(root)], deps: noGit })

    const opened = files.open(placeId('r-web', null), 'huge.log')

    expect(opened.size).toBe(whole.length)
    expect(opened.truncated).toBe(true)
    expect(opened.text).toHaveLength(HEAD_BYTES)
  })

  it('does not even try a file past the hard limit', () => {
    const root = temporary()
    writeFileSync(join(root, 'enormous.bin'), Buffer.alloc(TOO_BIG_BYTES + 1))
    const files = createFiles({ places: () => [place(root)], deps: noGit })

    expect(files.open(placeId('r-web', null), 'enormous.bin')).toMatchObject({
      kind: 'too-big',
      text: null,
      size: TOO_BIG_BYTES + 1,
    })
  })

  it('opens Markdown as Markdown, an image as a data URL and anything else as text', () => {
    const root = temporary()
    writeFileSync(join(root, 'README.md'), '# Title\n')
    writeFileSync(join(root, 'sprite.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
    writeFileSync(join(root, 'LICENCE'), 'All rights reserved\n')
    const files = createFiles({ places: () => [place(root)], deps: noGit })
    const open = (path: string) => files.open(placeId('r-web', null), path)

    expect(open('README.md')).toMatchObject({ kind: 'markdown', text: '# Title\n' })
    expect(open('sprite.png')).toMatchObject({ kind: 'image', text: null })
    expect(open('sprite.png').dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(open('LICENCE')).toMatchObject({ kind: 'text', language: null })
  })
})

describe('A place’s tree', () => {
  it('lists folders before files, skips what nobody wrote, and marks what the Employee changed', () => {
    const root = temporary()
    mkdirSync(join(root, 'src/office'), { recursive: true })
    mkdirSync(join(root, 'node_modules/left'), { recursive: true })
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'src/office/counter.ts'), 'a')
    writeFileSync(join(root, 'src/office/counter.test.ts'), 'b')
    writeFileSync(join(root, 'node_modules/left/index.js'), 'c')
    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main')
    const files = createFiles({
      places: () => [worktreePlace(root)],
      deps: {
        changes: () => ({ 'src/office/counter.test.ts': 'modified', 'src/gone.ts': 'removed' }),
        changedLines: () => [],
      },
    })

    const tree = files.tree(placeId('r-web', 142))

    expect(tree.truncated).toBe(false)
    expect(tree.entries.map((entry) => entry.path)).toEqual([
      'src',
      'src/office',
      'src/office/counter.test.ts',
      'src/office/counter.ts',
      'src/gone.ts',
      'package.json',
    ])
    expect(tree.entries.find((entry) => entry.path === 'src/office/counter.test.ts')?.change).toBe('modified')
    expect(tree.entries.find((entry) => entry.path === 'src/gone.ts')?.change).toBe('removed')
    expect(tree.entries.find((entry) => entry.path === 'src')?.change).toBe(null)
  })

  it('leaves a repo unmarked: only a worktree has an Employee’s changes', () => {
    const root = temporary()
    writeFileSync(join(root, 'a.ts'), 'a')
    const refuse = () => {
      throw new Error('a repo should never be diffed')
    }
    const files = createFiles({ places: () => [place(root)], deps: { changes: refuse, changedLines: refuse } })

    expect(files.tree(placeId('r-web', null)).entries).toEqual([{ path: 'a.ts', kind: 'file', change: null }])
    expect(files.open(placeId('r-web', null), 'a.ts').changedLines).toEqual([])
  })

  it('marks the lines the Employee changed in the file it opens', () => {
    const root = temporary()
    writeFileSync(join(root, 'counter.ts'), 'one\ntwo\nthree\n')
    const files = createFiles({
      places: () => [worktreePlace(root)],
      deps: { changes: () => ({ 'counter.ts': 'modified' }), changedLines: () => [16, 17] },
    })

    expect(files.open(placeId('r-web', 142), 'counter.ts')).toMatchObject({
      change: 'modified',
      changedLines: [16, 17],
    })
  })
})

describe('The places the view can open', () => {
  const worktree: Worktree = {
    ticketId: 142,
    repoId: 'r-web',
    path: onDisk('/work/acme/worktrees/ticket-142'),
    branch: 'ticket-142-the-counter-speaks',
    base: 'main',
    createdAt: '2026-09-21T09:00:00.000Z',
  }

  it('names a worktree by its repo, its holder and its ticket, and puts it before the repo', () => {
    const found = filePlaces({
      repos: [{ id: 'r-web', name: 'tinycorp', path: onDisk('/code/tinycorp') }],
      worktrees: [worktree],
      tickets: [{ id: 142, title: 'the counter speaks', assigneeId: 'e-ada' }],
      employees: [{ id: 'e-ada', name: 'Ada' }],
      companyKey: 'TC',
    })

    expect(found.map((one) => one.id)).toEqual(['worktree:142:r-web', 'repo:r-web'])
    expect(placeLabel(found[0]!)).toBe("tinycorp · Ada's worktree · TC-142 the counter speaks")
    expect(placeLabel(found[1]!)).toBe('tinycorp · the repository')
  })

  it('says which worktree has a Session running in it, and leaves a repo alone', () => {
    const found = filePlaces({
      repos: [{ id: 'r-web', name: 'tinycorp', path: onDisk('/code/tinycorp') }],
      worktrees: [worktree],
      tickets: [{ id: 142, title: 'the counter speaks', assigneeId: 'e-ada' }],
      employees: [{ id: 'e-ada', name: 'Ada' }],
      companyKey: 'TC',
      running: (employeeId) => employeeId === 'e-ada',
    })

    expect(found[0]).toMatchObject({ holderName: 'Ada', sessionRunning: true })
    expect(found[1]!.sessionRunning).toBe(false)
  })

  it('leaves out a worktree of a repo the Company no longer has', () => {
    const found = filePlaces({
      repos: [],
      worktrees: [worktree],
      tickets: [],
      employees: [],
      companyKey: 'TC',
    })

    expect(found).toEqual([])
  })

  // T262: the repo itself is a place, wherever it is — on this disk, or in a WSL distro whose
  // files this Windows process reaches over `\\wsl.localhost`.
  it.each([
    ['on this disk', onDisk('/code/tinycorp')],
    ['inside WSL', '\\\\wsl.localhost\\Ubuntu\\home\\boss\\code\\tinycorp'],
  ])('offers the repo itself %s, as well as its worktrees', (_where, path) => {
    const found = filePlaces({
      repos: [{ id: 'r-web', name: 'tinycorp', path }],
      worktrees: [worktree],
      tickets: [],
      employees: [],
      companyKey: 'TC',
    })

    const repo = found.find((one) => one.ticketId === null)
    expect(repo).toMatchObject({ id: 'repo:r-web', path })
    expect(placeLabel(repo!)).toBe('tinycorp · the repository')
    expect(found).toHaveLength(2)
  })
})

describe('What the boss may write (T122)', () => {
  /** The place, the reader over it, and the file as it was opened — digest and all. */
  function opened(text: string, path = 'docs/decisions.md') {
    const root = temporary()
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, path), text)
    const files = createFiles({ places: () => [place(root)], deps: noGit })
    return { root, files, id: placeId('r-web', null), file: files.open(placeId('r-web', null), path) }
  }

  it('writes the boss’s text to the worktree on disk and opens the file as it now reads', () => {
    const { root, files, id, file } = opened('one\n')

    const result = files.save(id, { path: 'docs/decisions.md', text: 'one\ntwo\n', digest: file.digest! })

    expect(result.saved).toBe(true)
    expect(readFileSync(join(root, 'docs/decisions.md'), 'utf8')).toBe('one\ntwo\n')
    if (!result.saved) throw new Error('the save was refused')
    expect(result.file).toMatchObject({ path: 'docs/decisions.md', kind: 'markdown', lines: 2 })
    expect(result.file.digest).not.toBe(file.digest)
  })

  it('refuses a write that climbs out of the place, leaving what is there alone', () => {
    const { root, files, id, file } = opened('mine\n')
    const above = join(root, '..', 'theirs.txt')
    writeFileSync(above, 'not yours')

    expect(() => files.save(id, { path: '../theirs.txt', text: 'clobbered', digest: file.digest! })).toThrow(
      /outside the place/,
    )
    expect(readFileSync(above, 'utf8')).toBe('not yours')
    rmSync(above, { force: true })
  })

  it('refuses a write into .git, wherever in the place it sits', () => {
    const { root, files, id, file } = opened('mine\n')
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main\n')

    expect(() => files.save(id, { path: '.git/HEAD', text: 'ref: refs/heads/theirs\n', digest: file.digest! })).toThrow(
      /\.git/,
    )
    expect(() => files.create(id, '.git/hooks/pre-commit')).toThrow(/\.git/)
    expect(readFileSync(join(root, '.git/HEAD'), 'utf8')).toBe('ref: refs/heads/main\n')
  })

  it('stops a save whose file changed underneath, and hands back both versions', () => {
    const { root, files, id, file } = opened('what the boss opened\n')
    // The Employee writes the file while the boss is typing.
    writeFileSync(join(root, 'docs/decisions.md'), 'what the Employee wrote\n')

    const result = files.save(id, { path: 'docs/decisions.md', text: 'what the boss typed\n', digest: file.digest! })

    expect(result.saved).toBe(false)
    if (result.saved) throw new Error('the save should have stopped')
    expect(result.conflict).toMatchObject({
      path: 'docs/decisions.md',
      theirs: 'what the Employee wrote\n',
      yours: 'what the boss typed\n',
    })
    // Nothing was overwritten by surprise: their text is still the one on disk.
    expect(readFileSync(join(root, 'docs/decisions.md'), 'utf8')).toBe('what the Employee wrote\n')
    // …and the boss who picks their own saves over exactly the text they were shown.
    const kept = files.save(id, {
      path: 'docs/decisions.md',
      text: 'what the boss typed\n',
      digest: result.conflict.theirDigest,
    })
    expect(kept.saved).toBe(true)
    expect(readFileSync(join(root, 'docs/decisions.md'), 'utf8')).toBe('what the boss typed\n')
  })

  it('makes an empty file inside the place, folders and all, and opens it', () => {
    const { root, files, id } = opened('one\n')

    const made = files.create(id, 'docs/notes/today.md')

    expect(existsSync(join(root, 'docs/notes/today.md'))).toBe(true)
    expect(made).toMatchObject({ path: 'docs/notes/today.md', kind: 'markdown', text: '', size: 0 })
    expect(made.digest).not.toBeNull()
  })

  it('refuses a name the place already has, and one that climbs out of it', () => {
    const { files, id } = opened('one\n')

    expect(() => files.create(id, 'docs/decisions.md')).toThrow(/already exists/)
    expect(() => files.create(id, '../escaped.md')).toThrow(/cannot climb out|outside the place/)
  })
})

describe('What git tells the view', () => {
  it('reads the changed lines from a patch’s headers alone', () => {
    const patch = [
      'diff --git a/src/counter.ts b/src/counter.ts',
      '@@ -15,0 +16,2 @@ export function counterLabel(',
      '+  const state = largestGroup(...)',
      '+  const spoken = standing.filter(...)',
      '@@ -40 +41 @@',
      '-old',
      '+new',
    ].join('\n')

    expect(changedLinesOf(patch)).toEqual([16, 17, 41])
  })

  it('reads the tree’s marks from --name-status, a rename counting as added', () => {
    const output = ['M\tsrc/counter.ts', 'A\tsrc/new.ts', 'D\tsrc/gone.ts', 'R096\tsrc/was.ts\tsrc/is.ts'].join('\n')

    expect(changesOfNameStatus(output)).toEqual({
      'src/counter.ts': 'modified',
      'src/new.ts': 'added',
      'src/gone.ts': 'removed',
      'src/is.ts': 'added',
    })
  })
})

describe('The labels the header and chips carry', () => {
  it('spells a size the way the viewer shows it', () => {
    expect(sizeLabel(1)).toBe('1 byte')
    expect(sizeLabel(940)).toBe('940 bytes')
    expect(sizeLabel(1536)).toBe('1.5 KB')
    expect(sizeLabel(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('keeps a path inside its root when it belongs there', () => {
    const root = temporary()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.ts'), 'a')

    expect(resolveInside(root, 'src/a.ts')).toMatch(/src[/\\]a\.ts$/)
  })
})
