import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { editorsChannels } from '../../../shared/domain/channels'
import { KNOWN_EDITORS, SYSTEM_DEFAULT } from '../../../shared/files/editors'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { APPLICATION_FOLDERS, createEditors, type EditorChoiceStore, type InstalledEditor } from './editors'
import { registerEditorsIpc } from './editors-ipc'

const installed = (id: string): InstalledEditor => {
  const editor = KNOWN_EDITORS.find((one) => one.id === id)!
  return { id: editor.id, name: editor.name, app: join(APPLICATION_FOLDERS[0]!, editor.apps[0]!) }
}

function setup(stored: string | null = null) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  let choice = stored
  const store: EditorChoiceStore = {
    read: () => choice,
    write: (next) => {
      choice = next
    },
  }
  const announced: unknown[] = []
  const editors = createEditors({
    store,
    find: () => [installed('vscode'), installed('zed')],
    editorEnv: () => undefined,
    onChanged: (state) => void announced.push(state),
  })
  registerEditorsIpc({ ipc, editors })
  return {
    announced,
    stored: () => choice,
    invoke: async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
  }
}

describe('Serving the Open in … button', () => {
  it('answers with what this Mac has and what is in force', async () => {
    const { invoke } = setup()

    expect(await invoke(editorsChannels.get)).toEqual({
      found: [
        { id: 'vscode', name: 'VS Code' },
        { id: 'zed', name: 'Zed' },
      ],
      choice: null,
      using: 'vscode',
    })
  })

  it('records the row the boss clicked and tells every window', async () => {
    const { invoke, announced, stored } = setup()

    expect(await invoke(editorsChannels.choose, 'zed')).toEqual({
      ok: true,
      value: expect.objectContaining({ choice: 'zed', using: 'zed' }),
    })
    expect(stored()).toBe('zed')
    expect(announced).toHaveLength(1)
  })

  it('takes the system default as a choice of its own', async () => {
    const { invoke, stored } = setup()

    expect(await invoke(editorsChannels.choose, SYSTEM_DEFAULT)).toEqual({
      ok: true,
      value: expect.objectContaining({ using: SYSTEM_DEFAULT }),
    })
    expect(stored()).toBe(SYSTEM_DEFAULT)
  })

  it('refuses anything that is not an editor it knows, and changes nothing', async () => {
    const { invoke, stored, announced } = setup()

    expect(await invoke(editorsChannels.choose, '/bin/sh -c evil')).toEqual({
      ok: false,
      error: expect.stringMatching(/Unknown editor/),
    })
    expect(stored()).toBe(null)
    expect(announced).toEqual([])
  })
})
