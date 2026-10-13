import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FileKind, OpenedFile } from '../../../shared/files/files'
import type { Diagnosed, LanguageReading, Outlined } from '../../../shared/files/language'
import type { FilesCodeProps } from './FilesPanel'

let BackToJump: typeof import('./CodeIntel').BackToJump
let LanguageNotice: typeof import('./CodeIntel').LanguageNotice
let Outline: typeof import('./CodeIntel').Outline
let Problems: typeof import('./CodeIntel').Problems
let NO_PROBLEMS: typeof import('./CodeIntel').NO_PROBLEMS
let FilesPanel: typeof import('./FilesPanel').FilesPanel

beforeAll(async () => {
  // These components read nothing of the preload API; the viewer's module reads it when it loads.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { files: {} } }
  ;({ BackToJump, LanguageNotice, NO_PROBLEMS, Outline, Problems } = await import('./CodeIntel'))
  ;({ FilesPanel } = await import('./FilesPanel'))
})

/** The words a piece of markup says, with the tags taken out. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const diagnosed = (extra: Partial<Diagnosed> = {}): Diagnosed => ({
  line: 5,
  column: 7,
  endLine: 5,
  endColumn: 13,
  severity: 'error',
  message: "Type 'string' is not assignable to type 'number'.",
  code: '2322',
  ...extra,
})

function file(kind: FileKind, extra: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: 'src/desk.ts',
    kind,
    size: 120,
    text: null,
    truncated: false,
    lines: null,
    dataUrl: null,
    language: 'ts',
    changedLines: [],
    change: null,
    digest: 'sha',
    ...extra,
  }
}

const reading = (extra: Partial<LanguageReading> = {}): LanguageReading => ({
  status: 'ready',
  reason: null,
  diagnostics: [],
  outline: [],
  ...extra,
})

describe('What the server says about a file', () => {
  it('lists the errors under the file, each on the line it is about', () => {
    const html = renderToStaticMarkup(
      <Problems
        diagnostics={[diagnosed(), diagnosed({ line: 9, severity: 'warning', message: 'Unused', code: null })]}
        onPick={() => {}}
      />,
    )

    expect(text(html)).toContain('1 error, 1 warning')
    expect(text(html)).toContain('5:7')
    expect(text(html)).toContain('is not assignable to type')
    expect(text(html)).toContain('2322')
    expect(html).toContain('files-problems__row--warning')
  })

  it('says a clean file is clean, and lists nothing at all', () => {
    const html = renderToStaticMarkup(<Problems diagnostics={[]} onPick={() => {}} />)

    expect(text(html)).toContain(NO_PROBLEMS)
    expect(html).not.toContain('files-problems__row')
  })
})

describe('The outline', () => {
  const outline: Outlined[] = [
    { name: 'FilePlace', kind: 'interface', line: 17, column: 18, depth: 0 },
    { name: 'path', kind: 'property', line: 23, column: 3, depth: 1 },
  ]

  it('lists what the file declares, indented as they nest, and marks the one the boss is in', () => {
    const html = renderToStaticMarkup(<Outline outline={outline} on={outline[1]} onPick={() => {}} />)

    expect(text(html)).toContain('FilePlace')
    expect(text(html)).toContain('path')
    expect(html).toContain('files-outline__row--on')
    expect(html).toContain('1 * var(--files-indent)')
  })
})

describe('A viewer with nothing reading it', () => {
  it('says why in one quiet line, and says nothing at all when there is nothing to say', () => {
    const quiet = renderToStaticMarkup(
      <LanguageNotice reading={reading({ status: 'none', reason: 'This repository has no TypeScript of its own.' })} />,
    )

    expect(text(quiet)).toBe('This repository has no TypeScript of its own.')
    expect(renderToStaticMarkup(<LanguageNotice reading={reading()} />)).toBe('')
  })

  it('marks a server that failed apart from a place that simply has none', () => {
    const failed = renderToStaticMarkup(<LanguageNotice reading={reading({ status: 'failed', reason: 'tsc died' })} />)

    expect(failed).toContain('files-language-notice--failed')
  })
})

describe('Coming back from a definition', () => {
  it('offers the way back to the file the boss followed a symbol from', () => {
    const html = renderToStaticMarkup(<BackToJump path="src/desk.ts" onBack={() => {}} />)

    expect(text(html)).toBe('Back')
    expect(html).toContain('Back to src/desk.ts')
  })
})

describe('The panel with a server behind it', () => {
  const language = (extra: Partial<LanguageReading> = {}) => ({
    reading: reading(extra),
    hover: async () => null,
    find: async () => null,
  })

  const panel = (code: FilesCodeProps) =>
    renderToStaticMarkup(
      <FilesPanel
        place={null}
        sidebar={{ rows: [], activePath: 'src/desk.ts', query: '', onQuery: () => {}, onPick: () => {} }}
        viewer={{
          tabs: [],
          activeKey: null,
          file: file('code', { text: 'const said = "hello"\n' }),
          view: { source: false, zoom: 1, pixels: false },
          onView: () => {},
          onPickTab: () => {},
          onCloseTab: () => {},
          onReveal: () => {},
        }}
        code={code}
      />,
    )

  it('draws the outline, the problems and the way back around the file', () => {
    const html = panel({
      language: language({
        diagnostics: [diagnosed()],
        outline: [{ name: 'said', kind: 'variable', line: 1, column: 7, depth: 0 }],
      }),
      back: 'src/counter.ts',
      onBack: () => {},
      onOpenDefinition: () => {},
    })

    expect(html).toContain('data-ui="Outline"')
    expect(html).toContain('data-ui="Problems"')
    expect(html).toContain('data-ui="Back"')
    expect(text(html)).toContain('1 error')
  })

  it('draws the file with nobody reading it, and no panel at all around it', () => {
    const html = panel({})

    expect(html).not.toContain('data-ui="Outline"')
    expect(html).not.toContain('data-ui="Problems"')
    expect(html).not.toContain('data-ui="Back"')
    expect(html).toContain('data-ui="Code editor"')
  })

  it('says nothing under a file it has nothing to say about yet', () => {
    const html = panel({ language: language({ status: 'starting', reason: null }), onOpenDefinition: () => {} })

    expect(html).not.toContain('data-ui="Problems"')
    expect(html).not.toContain('files-language-notice')
  })
})
