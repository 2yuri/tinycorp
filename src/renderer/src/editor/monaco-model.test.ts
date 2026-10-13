import { describe, expect, it } from 'vitest'
import type { Diagnosed } from '../../../shared/files/language'
import {
  codeFileOf,
  codeUriOf,
  hoverMarkdown,
  markersOf,
  monacoLanguageOf,
  PLAIN_TEXT,
  worstByLine,
} from './monaco-model'

/**
 * Everything the editor is told, without the editor (T222). Monaco measures text and cannot run in
 * jsdom, so the component around it is thin on purpose and every decision it makes is here.
 */

const said = (extra: Partial<Diagnosed>): Diagnosed => ({
  line: 3,
  column: 5,
  endLine: 3,
  endColumn: 9,
  severity: 'error',
  message: 'Type “number” is not assignable to type “string”.',
  code: '2322',
  ...extra,
})

describe('The language a file is drawn in', () => {
  it('reads the extension, which tells apart what OpenedFile.language collapses', () => {
    // `.ts`, `.tsx`, `.js` and `.jsx` are all `ts` to the reader; Monaco has two grammars for them.
    expect(monacoLanguageOf('src/counter.ts', 'ts')).toBe('typescript')
    expect(monacoLanguageOf('src/Counter.tsx', 'ts')).toBe('typescript')
    expect(monacoLanguageOf('tools/build.mjs', 'ts')).toBe('javascript')
    expect(monacoLanguageOf('tools/build.jsx', 'ts')).toBe('javascript')
  })

  it('colours what the little highlighter never could, because Monaco brings the grammar', () => {
    expect(monacoLanguageOf('src/main.rs', null)).toBe('rust')
    expect(monacoLanguageOf('cmd/serve.go', null)).toBe('go')
    expect(monacoLanguageOf('app/models/user.rb', null)).toBe('ruby')
  })

  it('names a whole file, for the ones that have no extension at all', () => {
    expect(monacoLanguageOf('Dockerfile', null)).toBe('dockerfile')
  })

  it('falls back to the file’s own id, and then to plain text', () => {
    expect(monacoLanguageOf('Makefile.inc', 'shell')).toBe('shell')
    expect(monacoLanguageOf('LICENSE', null)).toBe(PLAIN_TEXT)
  })

  it('gives TOML the shape it really has, since Monaco has no grammar of its own for it', () => {
    expect(monacoLanguageOf('Cargo.toml', 'toml')).toBe('ini')
  })
})

describe('What the server said, as Monaco’s markers', () => {
  it('carries the range, the message and the compiler’s own number across', () => {
    expect(markersOf([said({})])).toEqual([
      {
        severity: 8,
        message: 'Type “number” is not assignable to type “string”.',
        startLineNumber: 3,
        startColumn: 5,
        endLineNumber: 3,
        endColumn: 9,
        code: '2322',
      },
    ])
  })

  it('widens a range that ends where it starts, which would draw no squiggle at all', () => {
    expect(markersOf([said({ endColumn: 5 })])[0]).toMatchObject({ startColumn: 5, endColumn: 6 })
  })

  it('leaves the code out rather than saying undefined, which Monaco’s marker has no room for', () => {
    expect(Object.hasOwn(markersOf([said({ code: null })])[0]!, 'code')).toBe(false)
  })

  it('ranks the severities the way the editor does', () => {
    expect(markersOf([said({ severity: 'warning' }), said({ severity: 'info' })]).map((one) => one.severity)).toEqual([
      4, 2,
    ])
  })
})

describe('The dot in the gutter', () => {
  it('is the worst thing said about a line, however many things were said', () => {
    const worst = worstByLine([
      said({ line: 1, endLine: 1, severity: 'info' }),
      said({ line: 1, endLine: 1, severity: 'error' }),
      said({ line: 2, endLine: 2, severity: 'warning' }),
    ])

    expect([...worst]).toEqual([
      [1, 'error'],
      [2, 'warning'],
    ])
  })

  it('marks every line a diagnostic spans, as the viewer’s own mark always did', () => {
    expect([...worstByLine([said({ line: 4, endLine: 6, severity: 'warning' })]).keys()]).toEqual([4, 5, 6])
  })
})

describe('The URI a model is keyed by', () => {
  it('holds the place in the query, because a place id has colons in it', () => {
    expect(codeUriOf('worktree:142:r-web', 'src/counter.ts')).toEqual({
      scheme: 'tinycorp',
      path: '/src/counter.ts',
      query: 'worktree:142:r-web',
    })
  })

  it('comes back apart, which is how a followed declaration finds its tab', () => {
    const uri = codeUriOf('worktree:142:r-web', 'src/counter.ts')

    expect(codeFileOf(uri)).toEqual({ placeId: 'worktree:142:r-web', path: 'src/counter.ts' })
  })

  it('carries no place for a file from outside the Company, and gives none back', () => {
    const uri = codeUriOf(null, '/Users/boss/notes.ts')

    expect(uri.query).toBe('')
    expect(codeFileOf(uri)).toEqual({ placeId: null, path: 'Users/boss/notes.ts' })
  })
})

describe('The card under the pointer', () => {
  it('is the signature in a fence, and the doc comment under it', () => {
    expect(
      hoverMarkdown({
        signature: 'function counterLabel(standing: AtTheCounter[]): string',
        docs: 'Who is waiting, in the boss’s words.',
        range: { line: 1, column: 1, endLine: 1, endColumn: 2 },
      }),
    ).toEqual([
      '```ts\nfunction counterLabel(standing: AtTheCounter[]): string\n```',
      'Who is waiting, in the boss’s words.',
    ])
  })

  it('is the signature alone when the symbol has no doc comment', () => {
    expect(
      hoverMarkdown({ signature: 'const one: 1', docs: null, range: { line: 1, column: 1, endLine: 1, endColumn: 2 } }),
    ).toHaveLength(1)
  })
})
