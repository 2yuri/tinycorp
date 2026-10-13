import { describe, expect, it } from 'vitest'
import {
  type EditorsState,
  editorInForce,
  editorLabel,
  editorNamedByEnv,
  editorOptions,
  type FoundEditor,
  isEditorChoice,
  SYSTEM_DEFAULT,
  systemDefaultDetail,
} from './editors'

const vscode: FoundEditor = { id: 'vscode', name: 'VS Code' }
const cursor: FoundEditor = { id: 'cursor', name: 'Cursor' }
const zed: FoundEditor = { id: 'zed', name: 'Zed' }

function state(over: Partial<EditorsState> = {}): EditorsState {
  const found = over.found ?? [vscode, cursor, zed]
  const choice = over.choice ?? null
  return { found, choice, using: over.using ?? editorInForce(found, choice), ...over }
}

describe('The list behind the chevron', () => {
  it('is what was found on this Mac, and then the system default', () => {
    const rows = editorOptions(state(), 'docs/decisions.md')

    expect(rows.map((row) => row.name)).toEqual(['VS Code', 'Cursor', 'Zed', 'The system default'])
    expect(rows.slice(0, 3).map((row) => row.detail)).toEqual([
      'found on this Mac',
      'found on this Mac',
      'found on this Mac',
    ])
  })

  it('says under the system default what that means for the file at hand', () => {
    expect(systemDefaultDetail('src/counter.ts')).toBe('whatever opens a .ts today')
    expect(systemDefaultDetail('/work/acme/README.md')).toBe('whatever opens a .md today')
    expect(systemDefaultDetail('Makefile')).toBe('whatever opens this kind of file today')
    expect(systemDefaultDetail(null)).toBe('whatever opens this kind of file today')
  })

  it('ticks the one in use, and nothing else', () => {
    const rows = editorOptions(state({ choice: 'cursor', using: 'cursor' }))

    expect(rows.filter((row) => row.chosen).map((row) => row.id)).toEqual(['cursor'])
  })

  it('ticks the system default when that is the choice, and on a Mac with no editor', () => {
    expect(editorOptions(state({ choice: SYSTEM_DEFAULT, using: SYSTEM_DEFAULT })).filter((r) => r.chosen)).toEqual([
      {
        id: SYSTEM_DEFAULT,
        name: 'The system default',
        detail: 'whatever opens this kind of file today',
        chosen: true,
      },
    ])

    const bare = editorOptions(state({ found: [] }))
    expect(bare).toHaveLength(1)
    expect(bare[0]?.chosen).toBe(true)
  })
})

describe('What the button says', () => {
  it('names the editor the boss picked', () => {
    expect(editorLabel(state({ choice: 'zed', using: 'zed' }))).toBe('Open in Zed')
    expect(editorLabel(state({ choice: 'cursor', using: 'cursor' }))).toBe('Open in Cursor')
  })

  it('names the first one found when the boss has picked nothing', () => {
    expect(editorLabel(state({ found: [cursor, zed] }))).toBe('Open in Cursor')
  })

  it('falls back to the system default with no editor found at all', () => {
    expect(editorLabel(state({ found: [] }))).toBe('Open with the system default')
  })

  it('falls back to the system default when that is what the boss picked', () => {
    expect(editorLabel(state({ choice: SYSTEM_DEFAULT, using: SYSTEM_DEFAULT }))).toBe('Open with the system default')
  })
})

describe('What opens a file right now', () => {
  it('is the boss’s pick while that editor is still here', () => {
    expect(editorInForce([vscode, zed], 'zed')).toBe('zed')
  })

  it('is the editor $EDITOR names, when the boss has picked none', () => {
    expect(editorInForce([vscode, cursor, zed], null, 'zed --wait')).toBe('zed')
    expect(editorInForce([vscode, cursor, zed], null, '/usr/local/bin/cursor')).toBe('cursor')
  })

  it('ignores $EDITOR when it names something that is not here, or is not a command to run', () => {
    expect(editorNamedByEnv([vscode], 'vim')).toBe(null)
    expect(editorNamedByEnv([vscode], 'zed')).toBe(null)
    expect(editorNamedByEnv([vscode], '')).toBe(null)
    expect(editorNamedByEnv([vscode], undefined)).toBe(null)
    expect(editorInForce([vscode, cursor], null, 'vim')).toBe('vscode')
  })

  it('is the system default when the editor the boss picked is gone, and none was found', () => {
    expect(editorInForce([], 'cursor')).toBe(SYSTEM_DEFAULT)
    expect(editorInForce([], null, 'code')).toBe(SYSTEM_DEFAULT)
  })

  it('falls back to what is here when the editor the boss picked has been uninstalled', () => {
    expect(editorInForce([zed], 'cursor')).toBe('zed')
  })
})

describe('What the boss may pick', () => {
  it('is an editor the app knows, or the system default', () => {
    expect(isEditorChoice('vscode')).toBe(true)
    expect(isEditorChoice(SYSTEM_DEFAULT)).toBe(true)
    expect(isEditorChoice('rm -rf /')).toBe(false)
    expect(isEditorChoice(null)).toBe(false)
  })
})
