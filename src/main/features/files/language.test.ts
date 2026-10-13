import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { type FilePlace, placeId } from '../../../shared/files/files'
import { onDisk, removeFolder } from '../../core/testing'
import {
  createLanguage,
  definedAt,
  diagnosedOf,
  hoveredOf,
  type LanguageDeps,
  NO_SERVER,
  NOT_A_LANGUAGE,
  outlinedOf,
  positionOf,
  START_ATTEMPTS,
  targetOf,
  typescriptAt,
  typescriptServers,
} from './language'
import type { LspProcess } from './lsp-client'

const folders: string[] = []
const stops: (() => void)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  for (const folder of folders.splice(0)) removeFolder(folder)
})

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-language-'))
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

/**
 * A repo of two files, with a deliberate error in one of them and the running project's own
 * TypeScript linked in — never a bundled copy, so the fixture reads its types the way the app does.
 */
function fixtureRepo(): string {
  const root = temporary()
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, target: 'esnext', module: 'preserve', noEmit: true } }),
  )
  writeFileSync(
    join(root, 'counter.ts'),
    [
      '/** How many times the counter has spoken. */',
      'export function times(of: string): number {',
      '  return of.length',
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'desk.ts'),
    [
      'import { times } from "./counter"',
      '',
      'export const said = times("hello")',
      '',
      'const broken: number = "not a number"',
      'export { broken }',
      '',
    ].join('\n'),
  )
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(ourTypescript(), join(root, 'node_modules', 'typescript'), 'dir')
  return root
}

/** The TypeScript this very test run is using, which is what the fixture is given. */
function ourTypescript(): string {
  const found = typescriptAt(dirname(fileURLToPath(import.meta.url)))
  if (found === null) throw new Error('This repo has no TypeScript of its own to lend the fixture')
  return resolve(found.bin, '..', '..')
}

describe('The language server of a place', () => {
  it('gives the type and the doc comment of the symbol under the pointer', async () => {
    const root = fixtureRepo()
    const language = createLanguage({ places: () => [place(root)] })
    stops.push(language.stop)
    const text = 'import { times } from "./counter"\n\nexport const said = times("hello")\n'
    // `times` in the call on line 3, whose declaration is a file away.
    const hover = await language.hover(placeId('r-web', null), 'desk.ts', { line: 3, column: 22 }, text)
    expect(hover?.signature).toContain('function times(of: string): number')
    expect(hover?.docs).toContain('How many times the counter has spoken.')
  }, 60_000)

  it('resolves a definition across files, back into the place it belongs to', async () => {
    const root = fixtureRepo()
    const id = placeId('r-web', null)
    const language = createLanguage({ places: () => [place(root)] })
    stops.push(language.stop)
    const text = 'import { times } from "./counter"\n\nexport const said = times("hello")\n'
    const found = await language.definition(id, 'desk.ts', { line: 3, column: 22 }, text)
    expect(found).toEqual({ placeId: id, path: 'counter.ts', line: 2, column: 17 })
  }, 60_000)

  it('puts a deliberate error on the line that holds it, and lists what the file declares', async () => {
    const root = fixtureRepo()
    const language = createLanguage({ places: () => [place(root)] })
    stops.push(language.stop)
    const text = [
      'import { times } from "./counter"',
      '',
      'export const said = times("hello")',
      '',
      'const broken: number = "not a number"',
      'export { broken }',
      '',
    ].join('\n')
    const reading = await language.read(placeId('r-web', null), 'desk.ts', text)
    expect(reading.status).toBe('ready')
    expect(reading.reason).toBeNull()
    const error = reading.diagnostics.find((one) => one.severity === 'error')
    expect(error?.line).toBe(5)
    expect(error?.message).toMatch(/not assignable to type 'number'/)
    expect(reading.outline.map((one) => one.name)).toContain('broken')
    expect(reading.outline.find((one) => one.name === 'said')).toMatchObject({ kind: 'variable', line: 3 })
  }, 60_000)

  it('follows the text in the editor, not the file on disk: a fixed error stops being reported', async () => {
    const root = fixtureRepo()
    const id = placeId('r-web', null)
    const language = createLanguage({ places: () => [place(root)] })
    stops.push(language.stop)
    const broken = 'const broken: number = "not a number"\nexport { broken }\n'
    expect((await language.read(id, 'desk.ts', broken)).diagnostics).not.toEqual([])
    const fixed = 'const broken: number = 3\nexport { broken }\n'
    expect((await language.read(id, 'desk.ts', fixed)).diagnostics).toEqual([])
  }, 60_000)
})

describe('A place the viewer has nothing to read with', () => {
  it('opens files anyway, saying only that there is no server for the repo', async () => {
    const language = createLanguage({ places: () => [place(temporary())], deps: { start: () => null } })
    stops.push(language.stop)
    const reading = await language.read(placeId('r-web', null), 'desk.ts', 'const a = 1\n')
    expect(reading).toEqual({ status: 'none', reason: NO_SERVER, diagnostics: [], outline: [] })
    expect(await language.hover(placeId('r-web', null), 'desk.ts', { line: 1, column: 7 }, 'const a = 1\n')).toBeNull()
    expect(
      await language.definition(placeId('r-web', null), 'desk.ts', { line: 1, column: 7 }, 'const a = 1\n'),
    ).toBeNull()
  })

  it('says so and starts nothing at all for a file no server speaks for', async () => {
    let started = 0
    const deps: LanguageDeps = {
      start: () => {
        started++
        return null
      },
    }
    const language = createLanguage({ places: () => [place(temporary())], deps })
    stops.push(language.stop)
    const reading = await language.read(placeId('r-web', null), 'docs/product.md', '# Product\n')
    expect(reading).toEqual({ status: 'none', reason: NOT_A_LANGUAGE, diagnostics: [], outline: [] })
    expect(started).toBe(0)
  })

  it('degrades with the reason when the server will not start, and does not keep trying', async () => {
    let tried = 0
    const deps: LanguageDeps = {
      start: () => {
        tried++
        throw new Error('tsc is not executable')
      },
    }
    const language = createLanguage({ places: () => [place(temporary())], deps })
    stops.push(language.stop)
    const reading = await language.read(placeId('r-web', null), 'desk.ts', 'const a = 1\n')
    expect(reading).toMatchObject({ status: 'failed', reason: 'tsc is not executable' })
    await language.read(placeId('r-web', null), 'desk.ts', 'const a = 1\n')
    expect(tried).toBe(1)
  })

  it('refuses a place the Company does not have open', async () => {
    const language = createLanguage({ places: () => [], deps: { start: () => null } })
    stops.push(language.stop)
    await expect(language.read('repo:nowhere', 'desk.ts', '')).rejects.toThrow(/No repo or worktree/)
  })

  it('gives a server that started and then died another go, but not for ever', async () => {
    let started = 0
    const deps: LanguageDeps = {
      start: () => {
        started++
        return { process: dyingServer(), name: 'Flaky' }
      },
    }
    const language = createLanguage({ places: () => [place(temporary())], deps, timeoutMs: 20 })
    stops.push(language.stop)
    for (let ask = 0; ask < START_ATTEMPTS + 3; ask++) {
      expect((await language.read(placeId('r-web', null), 'desk.ts', 'const a = 1\n')).status).toBe('failed')
    }
    expect(started).toBe(START_ATTEMPTS)
  })

  it('degrades with the reason when the server answers nothing at all', async () => {
    const language = createLanguage({
      places: () => [place(temporary())],
      deps: { start: () => ({ process: silentServer(), name: 'Silent' }) },
      timeoutMs: 20,
    })
    stops.push(language.stop)
    const reading = await language.read(placeId('r-web', null), 'desk.ts', 'const a = 1\n')
    expect(reading.status).toBe('failed')
    expect(reading.reason).toMatch(/did not (start|answer .*) in time/)
    expect(reading.diagnostics).toEqual([])
  })
})

/** A server that falls over the moment anyone speaks to it. */
function dyingServer(): LspProcess {
  let exited: (code: unknown) => void = () => {}
  queueMicrotask(() => exited(1))
  return {
    stdin: { write: () => true, end: () => {} },
    stdout: { on: () => {} },
    on: (event, listener) => {
      if (event === 'exit') exited = listener as (code: unknown) => void
    },
    kill: () => {},
  }
}

/** A server that takes everything and says nothing back. */
function silentServer(): LspProcess {
  return {
    stdin: { write: () => true, end: () => {} },
    stdout: { on: () => {} },
    on: () => {},
    kill: () => {},
  }
}

describe('Reading what a server says', () => {
  it('numbers lines and columns from one, where the protocol numbers them from zero', () => {
    expect(positionOf({ line: 1, column: 1 })).toEqual({ line: 0, character: 0 })
    expect(positionOf({ line: 12, column: 5 })).toEqual({ line: 11, character: 4 })
  })

  it('reads a pulled diagnostic report and a bare list of them the same way', () => {
    const item = {
      range: { start: { line: 4, character: 6 }, end: { line: 4, character: 12 } },
      severity: 2,
      message: 'Unused',
      code: 6133,
    }
    const expected = {
      line: 5,
      column: 7,
      endLine: 5,
      endColumn: 13,
      severity: 'warning',
      message: 'Unused',
      code: '6133',
    }
    expect(diagnosedOf({ kind: 'full', items: [item] })).toEqual([expected])
    expect(diagnosedOf([item])).toEqual([expected])
    expect(diagnosedOf(null)).toEqual([])
  })

  it('leaves the workings of a function out: they are no way to find anything', () => {
    const symbols = [
      {
        name: 'spansOf',
        kind: 12,
        selectionRange: { start: { line: 18, character: 16 } },
        children: [
          { name: 'column', kind: 13, selectionRange: { start: { line: 19, character: 6 } }, children: [] },
          { name: 'tokens.map() callback', kind: 12, selectionRange: { start: { line: 20, character: 20 } } },
        ],
      },
    ]
    expect(outlinedOf(symbols)).toEqual([{ name: 'spansOf', kind: 'function', line: 19, column: 17, depth: 0 }])
  })

  it('flattens nested symbols to the depth the outline indents by', () => {
    const symbols = [
      {
        name: 'FilePlace',
        kind: 11,
        selectionRange: { start: { line: 16, character: 17 } },
        children: [{ name: 'path', kind: 7, selectionRange: { start: { line: 22, character: 2 } }, children: [] }],
      },
    ]
    expect(outlinedOf(symbols)).toEqual([
      { name: 'FilePlace', kind: 'interface', line: 17, column: 18, depth: 0 },
      { name: 'path', kind: 'property', line: 23, column: 3, depth: 1 },
    ])
  })

  it('reads the flat symbol shape an older server answers with', () => {
    const symbols = [{ name: 'times', kind: 12, location: { range: { start: { line: 1, character: 16 } } } }]
    expect(outlinedOf(symbols)).toEqual([{ name: 'times', kind: 'function', line: 2, column: 17, depth: 0 }])
  })

  it('takes the signature out of its fence and leaves the doc comment under it', () => {
    const hover = hoveredOf(
      {
        contents: {
          kind: 'markdown',
          value: '```typescript\nfunction times(of: string): number\n```\nHow many times.',
        },
        range: { start: { line: 2, character: 20 }, end: { line: 2, character: 25 } },
      },
      { line: 3, column: 22 },
    )
    expect(hover).toEqual({
      signature: 'function times(of: string): number',
      docs: 'How many times.',
      range: { line: 3, column: 21, endLine: 3, endColumn: 26 },
    })
  })

  it('reads a hover with nothing under it, and has nothing to show for an empty one', () => {
    expect(
      hoveredOf({ contents: { kind: 'markdown', value: '```ts\nconst a: 1\n```' } }, { line: 1, column: 7 }),
    ).toEqual({
      signature: 'const a: 1',
      docs: null,
      range: { line: 1, column: 7, endLine: 1, endColumn: 8 },
    })
    expect(hoveredOf({ contents: { kind: 'markdown', value: '' } }, { line: 1, column: 1 })).toBeNull()
    expect(hoveredOf(null, { line: 1, column: 1 })).toBeNull()
  })

  it('takes the first of the places a definition may be, in either shape the protocol allows', () => {
    expect(targetOf([{ uri: 'file:///a.ts', range: { start: { line: 3, character: 4 } } }])).toEqual({
      uri: 'file:///a.ts',
      spot: { line: 4, column: 5 },
    })
    expect(targetOf({ targetUri: 'file:///a.ts', targetSelectionRange: { start: { line: 0, character: 0 } } })).toEqual(
      { uri: 'file:///a.ts', spot: { line: 1, column: 1 } },
    )
    expect(targetOf([])).toBeNull()
  })
})

describe('Where a definition lands', () => {
  const repo = place(onDisk('/Users/boss/tinycorp'))
  const worktree = place(onDisk('/Users/boss/tinycorp-worktrees/142'), { id: placeId('r-web', 142), ticketId: 142 })

  it('stays in the place the click came from when both hold the file', () => {
    const target = {
      uri: pathToFileURL(onDisk('/Users/boss/tinycorp-worktrees/142/src/a.ts')).href,
      spot: { line: 4, column: 2 },
    }
    expect(definedAt(target, [repo, worktree], worktree)).toEqual({
      placeId: worktree.id,
      path: 'src/a.ts',
      line: 4,
      column: 2,
    })
  })

  it('falls back to another place of the Company when the one clicked in does not hold it', () => {
    const target = { uri: pathToFileURL(onDisk('/Users/boss/tinycorp/src/a.ts')).href, spot: { line: 1, column: 1 } }
    expect(definedAt(target, [repo, worktree], worktree)).toMatchObject({ placeId: repo.id, path: 'src/a.ts' })
  })

  it('hands back the whole path of a file the Company owns nowhere, to open on its own', () => {
    const target = { uri: pathToFileURL(onDisk('/opt/lib/lib.es5.d.ts')).href, spot: { line: 9, column: 3 } }
    expect(definedAt(target, [repo], repo)).toEqual({
      placeId: null,
      path: onDisk('/opt/lib/lib.es5.d.ts'),
      line: 9,
      column: 3,
    })
  })
})

describe('Which TypeScript a place gets', () => {
  it('finds the one the repo has, walking up the way Node resolves it', () => {
    const found = typescriptAt(dirname(fileURLToPath(import.meta.url)))
    expect(found?.bin).toBe(resolve(process.cwd(), 'node_modules/typescript/bin/tsc'))
    expect(found?.version).toMatch(/^\d+\./)
  })

  it('gets none, and so no server at all, where there is no TypeScript above it', () => {
    const bare = temporary()
    expect(typescriptAt(join(bare, 'nothing', 'here'))).toBeNull()
    expect(typescriptServers.start(join(bare, 'nothing', 'here'))).toBeNull()
  })
})
