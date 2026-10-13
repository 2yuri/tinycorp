import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isEditorChoice } from '../../../shared/files/editors'
import type { EditorChoiceStore } from './editors'

/**
 * Which editor the boss opens files in, as a JSON file: normally `editor.json` beside
 * `boss-profile.json` in Electron's userData folder. One boss, one choice, whatever Companies are
 * open (T123, decision 47).
 */
export function editorChoiceFile(file: string): EditorChoiceStore {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        const editor = (parsed as { editor?: unknown })?.editor
        return isEditorChoice(editor) ? editor : null
      } catch {
        return null
      }
    },
    write(editor: string) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ editor }, null, 2))
    },
  }
}
