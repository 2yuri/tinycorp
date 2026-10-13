import { describe, expect, it } from 'vitest'
import type { FileEntry, FilePlace, OpenedFile } from '../../../shared/files/files'
import {
  changeMark,
  crumbsOf,
  fileChips,
  fileRows,
  firstFile,
  firstOpenFolders,
  foldersOf,
  looksLikeSprite,
  openedFor,
  pickerPlaces,
  refusalNotice,
  toggleFolder,
  truncationNotice,
} from './files-model'
import { inlineSpans, markdownBlocks } from './markdown'

const entries: FileEntry[] = [
  { path: 'src', kind: 'folder', change: null },
  { path: 'src/shared', kind: 'folder', change: null },
  { path: 'src/shared/office', kind: 'folder', change: null },
  { path: 'src/shared/office/counter.ts', kind: 'file', change: null },
  { path: 'src/shared/office/counter.test.ts', kind: 'file', change: 'modified' },
  { path: 'src/renderer', kind: 'folder', change: null },
  { path: 'docs', kind: 'folder', change: null },
  { path: 'package.json', kind: 'file', change: null },
]

const file: OpenedFile = {
  path: 'src/shared/office/counter.ts',
  kind: 'code',
  size: 1240,
  text: 'export const one = 1\n',
  truncated: false,
  lines: 48,
  dataUrl: null,
  language: 'ts',
  changedLines: [16, 17],
  change: 'modified',
  digest: 'sha',
}

describe('The tree the panel draws', () => {
  it('shows only what the open folders let through', () => {
    const rows = fileRows({ entries, open: new Set(['src']) })

    expect(rows.map((row) => row.path)).toEqual(['src', 'src/shared', 'src/renderer', 'docs', 'package.json'])
    expect(rows.find((row) => row.path === 'src')).toMatchObject({ label: 'src', depth: 0, open: true })
    expect(rows.find((row) => row.path === 'src/shared')).toMatchObject({ label: 'shared', depth: 1, open: false })
  })

  it('carries the mark of a file the Employee changed, and none for a folder', () => {
    const rows = fileRows({ entries, open: new Set(['src', 'src/shared', 'src/shared/office']) })

    expect(rows.find((row) => row.path === 'src/shared/office/counter.test.ts')?.change).toBe('modified')
    expect(changeMark('modified')).toBe('M')
    expect(changeMark('added')).toBe('A')
    expect(changeMark('removed')).toBe('D')
    expect(changeMark(null)).toBe(null)
  })

  it('filters to the files the find box asks for, folders and folding forgotten', () => {
    const rows = fileRows({ entries, open: new Set(), query: 'counter' })

    expect(rows.map((row) => row.label)).toEqual(['src/shared/office/counter.ts', 'src/shared/office/counter.test.ts'])
    expect(rows.every((row) => row.depth === 0 && row.kind === 'file')).toBe(true)
    expect(fileRows({ entries, open: new Set(), query: 'COUNTER.TEST' })).toHaveLength(1)
    expect(fileRows({ entries, open: new Set(), query: 'nothing at all' })).toEqual([])
  })

  it('opens the way down to a file, and folds a folder shut again', () => {
    expect(foldersOf('src/shared/office/counter.ts')).toEqual(['src', 'src/shared', 'src/shared/office'])
    expect([...openedFor(new Set(['docs']), 'src/shared/counter.ts')]).toEqual(['docs', 'src', 'src/shared'])
    expect([...toggleFolder(new Set(['src']), 'src')]).toEqual([])
    expect([...toggleFolder(new Set(), 'src')]).toEqual(['src'])
  })

  it('starts on the file the Employee is in, with the way to it open', () => {
    expect(firstFile(entries)).toBe('src/shared/office/counter.test.ts')
    expect(firstFile([{ path: 'a.ts', kind: 'file', change: null }])).toBe('a.ts')
    expect(firstFile([])).toBe(null)
    expect([...firstOpenFolders(entries, 'src/shared/office/counter.ts')]).toEqual([
      'src',
      'src/shared',
      'src/shared/office',
    ])
    expect([...firstOpenFolders(entries, null)]).toEqual(['src', 'docs'])
  })
})

describe('What the viewer’s head says', () => {
  it('breaks the path into crumbs', () => {
    expect(crumbsOf('src/shared/office/counter.ts')).toEqual(['src', 'shared', 'office', 'counter.ts'])
  })

  it('names whoever is in the file, then its lines and its size', () => {
    expect(fileChips(file, 'Ada')).toEqual([
      { text: 'Ada is in this file', tone: 'change' },
      { text: '48 lines', tone: 'plain' },
      { text: '1.2 KB', tone: 'plain' },
    ])
  })

  it('says nobody is in a file nobody touched', () => {
    const untouched = { ...file, change: null, changedLines: [] }

    expect(fileChips(untouched, 'Ada').map((chip) => chip.tone)).toEqual(['plain', 'plain'])
  })

  it('says what was left out, and what it would not try at all', () => {
    expect(truncationNotice(file)).toBe(null)
    expect(truncationNotice({ ...file, truncated: true, text: 'x'.repeat(2048), size: 4096 })).toBe(
      'Only the first 2.0 KB of 4.0 KB is shown. Open in editor for the rest.',
    )
    expect(refusalNotice({ ...file, kind: 'binary', text: null, size: 2048 })).toMatch(/binary file \(2\.0 KB\)/)
    expect(refusalNotice({ ...file, kind: 'too-big', text: null, size: 9 * 1024 * 1024 })).toMatch(/9\.0 MB, too big/)
    expect(refusalNotice(file)).toBe(null)
  })

  it('knows a sprite sheet wants its pixels kept', () => {
    expect(looksLikeSprite('design/office/character-sheet.png')).toBe(true)
    expect(looksLikeSprite('docs/photo.jpg')).toBe(false)
  })
})

describe('Markdown as the viewer draws it', () => {
  it('reads headings, lists, quotes, rules, fenced code and paragraphs', () => {
    const source = [
      '# Title',
      '',
      'A paragraph that',
      'runs over two lines.',
      '',
      '- one',
      '- two',
      '',
      '> a quote',
      '',
      '---',
      '',
      '```ts',
      'const a = 1',
      '```',
    ].join('\n')

    expect(markdownBlocks(source)).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'A paragraph that runs over two lines.' },
      { kind: 'list', ordered: false, items: ['one', 'two'] },
      { kind: 'quote', text: 'a quote' },
      { kind: 'rule' },
      { kind: 'code', language: 'ts', text: 'const a = 1' },
    ])
  })

  it('reads a table, so a wall of pipes never reaches the page as a paragraph', () => {
    const source = [
      '| # | Decision | Why |',
      '|---|:---:|---:|',
      '| 1 | Real orchestrator | The office is the hook |',
      '| 2 | Roles are data |',
      '',
      'After.',
    ].join('\n')

    expect(markdownBlocks(source)).toEqual([
      {
        kind: 'table',
        head: ['#', 'Decision', 'Why'],
        align: [null, 'center', 'right'],
        rows: [
          ['1', 'Real orchestrator', 'The office is the hook'],
          // A row shorter than the header is padded rather than dropped.
          ['2', 'Roles are data', ''],
        ],
      },
      { kind: 'paragraph', text: 'After.' },
    ])
  })

  it('leaves a sentence with a pipe in it alone: only a delimiter row makes a table', () => {
    expect(markdownBlocks('The | key is a pipe.')).toEqual([{ kind: 'paragraph', text: 'The | key is a pipe.' }])
  })

  it('keeps an escaped pipe inside its cell', () => {
    const source = ['| Sign |', '|---|', '| a \\| b |'].join('\n')

    expect(markdownBlocks(source)).toEqual([{ kind: 'table', head: ['Sign'], align: [null], rows: [['a | b']] }])
  })

  it('reads the spans inside a line', () => {
    expect(inlineSpans('see `code`, **bold**, *thin* and [a link](https://x.test)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ', ' },
      { kind: 'strong', text: 'bold' },
      { kind: 'text', text: ', ' },
      { kind: 'emphasis', text: 'thin' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'a link', href: 'https://x.test' },
    ])
  })

  it('leaves a line with nothing to mark as one span', () => {
    expect(inlineSpans('plain words')).toEqual([{ kind: 'text', text: 'plain words' }])
  })
})

describe('the place picker (T262)', () => {
  const place = (repoId: string, ticketId: number | null, path: string): FilePlace => ({
    id: ticketId === null ? `repo:${repoId}` : `worktree:${ticketId}:${repoId}`,
    repoId,
    repoName: repoId,
    path,
    ticketId,
    ticketKey: ticketId === null ? null : `TC-${ticketId}`,
    ticketTitle: null,
    holderName: null,
    branch: null,
    base: null,
    sessionRunning: false,
  })

  it('lists each repo itself first, then the worktrees cut from it — on a disk or in WSL', () => {
    const engine = [
      place('web', 142, '/work/acme/worktrees/ticket-142'),
      place('api', 150, '\\\\wsl.localhost\\Ubuntu\\home\\boss\\worktrees\\ticket-150'),
      place('web', 151, '/work/acme/worktrees/ticket-151'),
      place('web', null, '/code/web'),
      place('api', null, '\\\\wsl.localhost\\Ubuntu\\home\\boss\\code\\api'),
    ]

    expect(pickerPlaces(engine).map((one) => one.id)).toEqual([
      'repo:web',
      'worktree:142:web',
      'worktree:151:web',
      'repo:api',
      'worktree:150:api',
    ])
  })
})
