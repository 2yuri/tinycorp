import { describe, expect, it } from 'vitest'
import { type Diagnosed, diagnosticsSummary, languageIdOf, onLine, worstOf } from './language'

const at = (line: number, severity: Diagnosed['severity'] = 'error', endLine = line): Diagnosed => ({
  line,
  column: 1,
  endLine,
  endColumn: 4,
  severity,
  message: 'Type string is not assignable to type number.',
  code: '2322',
})

describe('What the viewer calls a file', () => {
  it('names the language a server speaks for, by extension', () => {
    expect(languageIdOf('src/main/engine/files.ts')).toBe('typescript')
    expect(languageIdOf('src/renderer/src/files/FilesView.tsx')).toBe('typescriptreact')
    expect(languageIdOf('tools/dev-identity.mjs')).toBe('javascript')
  })

  it('has nothing to say about a file no server speaks for', () => {
    expect(languageIdOf('docs/product.md')).toBeNull()
    expect(languageIdOf('Makefile')).toBeNull()
    expect(languageIdOf('.gitignore')).toBeNull()
  })
})

describe('What the head says about a file', () => {
  it('counts errors and warnings apart, as the boss reads them', () => {
    expect(diagnosticsSummary([at(3), at(9), at(12, 'warning')])).toBe('2 errors, 1 warning')
    expect(diagnosticsSummary([at(3)])).toBe('1 error')
    expect(diagnosticsSummary([])).toBe('')
  })

  it('takes the worst of them, so a clean file says nothing at all', () => {
    expect(worstOf([at(3, 'warning'), at(9)])).toBe('error')
    expect(worstOf([at(3, 'warning')])).toBe('warning')
    expect(worstOf([])).toBeNull()
  })
})

describe('The mark on a line', () => {
  it('marks every line a complaint runs over, not only the one it starts on', () => {
    const spread = at(4, 'error', 6)
    expect(onLine([spread], 3)).toEqual([])
    expect(onLine([spread], 5)).toEqual([spread])
    expect(onLine([spread], 6)).toEqual([spread])
    expect(onLine([spread], 7)).toEqual([])
  })
})
