import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { KNOWN_EDITORS, SYSTEM_DEFAULT } from '../../../shared/files/editors'
import { editorChoiceFile } from './editor-choice-file'
import {
  APPLICATION_FOLDERS,
  createEditors,
  type EditorChoiceStore,
  findEditors,
  type InstalledEditor,
  linuxEditorFolders,
} from './editors'

/** `/Applications`, joined the way the module joins it — which is `\Applications` on Windows (T166). */
const application = (name: string) => join(APPLICATION_FOLDERS[0]!, name)

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function temporary(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-editors-'))
  folders.push(folder)
  return folder
}

const bundleId = (id: string) => KNOWN_EDITORS.find((one) => one.id === id)!.bundleId

/** A Mac whose application folder holds exactly these bundles, each with its real `Info.plist`. */
function mac(bundles: Record<string, string>) {
  return (path: string): string | null => bundles[path] ?? null
}

function plists(...ids: string[]): Record<string, string> {
  const files: Record<string, string> = {}
  for (const id of ids) {
    const editor = KNOWN_EDITORS.find((one) => one.id === id)!
    files[join('/Applications', editor.apps[0]!, 'Contents', 'Info.plist')] =
      `<plist><dict><key>CFBundleIdentifier</key><string>${editor.bundleId}</string></dict></plist>`
  }
  return files
}

function memoryStore(initial: string | null = null): EditorChoiceStore {
  let choice = initial
  return {
    read: () => choice,
    write(next) {
      choice = next
    },
  }
}

const installed = (id: string): InstalledEditor => {
  const editor = KNOWN_EDITORS.find((one) => one.id === id)!
  return { id: editor.id, name: editor.name, app: join('/Applications', editor.apps[0]!) }
}

describe('Finding the editors on this Mac', () => {
  it('finds the applications themselves, by the bundle id each one carries', () => {
    const found = findEditors({ platform: 'darwin', home: '/Users/boss', readFile: mac(plists('vscode', 'zed')) })

    expect(found.map((one) => one.name)).toEqual(['VS Code', 'Zed'])
    expect(found[0]?.app).toBe(application('Visual Studio Code.app'))
  })

  it('looks in the boss’s own Applications folder too', () => {
    const app = join('/Users/boss/Applications', 'Cursor.app')
    const found = findEditors({
      platform: 'darwin',
      home: '/Users/boss',
      readFile: mac({ [join(app, 'Contents', 'Info.plist')]: `id: ${bundleId('cursor')}` }),
    })

    expect(found).toEqual([{ id: 'cursor', name: 'Cursor', app }])
  })

  it('passes over a bundle whose Info.plist names something else entirely', () => {
    const app = join('/Applications', 'Zed.app')
    const found = findEditors({
      platform: 'darwin',
      home: '/Users/boss',
      readFile: mac({ [join(app, 'Contents', 'Info.plist')]: 'com.example.NotZed' }),
    })

    expect(found).toEqual([])
  })

  it('looks for no bundle off macOS: an `.app` on a Linux PATH is not an editor', () => {
    const found = findEditors({
      platform: 'linux',
      readFile: mac(plists('vscode')),
      env: { PATH: '' },
      alsoLookIn: [],
    })

    expect(found).toEqual([])
  })
})

/**
 * Finding an editor on a Linux desktop (T177). `findEditors` answered `[]` off macOS, so every
 * Linux boss was told the only way to open a file was the system default — on the platform where
 * `code` is on `PATH` more reliably than anywhere else.
 *
 * Nothing is run to find out: each of an editor's commands is looked for as a file with the
 * execute bit, through the same resolver that finds the Provider CLIs.
 */
describe('Finding the editors on a Linux desktop', () => {
  /** A folder holding these executables, as a `PATH` entry. */
  function bin(...commands: string[]): string {
    const folder = temporary()
    for (const command of commands) {
      const file = join(folder, command)
      writeFileSync(file, '#!/bin/sh\nexit 0\n')
      chmodSync(file, 0o755)
    }
    return folder
  }

  const linux = (options: { path?: string[]; alsoLookIn?: string[] } = {}) =>
    findEditors({
      platform: 'linux',
      env: { PATH: (options.path ?? []).join(delimiter) },
      alsoLookIn: options.alsoLookIn ?? [],
    })

  it('finds an editor by its command on PATH, and says where it is', () => {
    const folder = bin('code', 'zed')

    const found = linux({ path: [folder] })

    expect(found.map((one) => one.name)).toEqual(['VS Code', 'Zed'])
    expect(found[0]?.app).toBe(join(folder, 'code'))
  })

  it('knows the names a flatpak and a snap install it under', () => {
    // A VS Code from flathub is only ever `com.visualstudio.code`, in a folder of its own.
    const flatpak = bin('com.visualstudio.code')

    expect(linux({ alsoLookIn: [flatpak] }).map((one) => one.id)).toEqual(['vscode'])
  })

  it('finds a JetBrains IDE by whichever of the family is installed', () => {
    expect(linux({ path: [bin('webstorm')] }).map((one) => one.name)).toEqual(['JetBrains'])
    expect(linux({ path: [bin('pycharm')] }).map((one) => one.name)).toEqual(['JetBrains'])
    expect(linux({ path: [bin('rustrover')] }).map((one) => one.name)).toEqual(['JetBrains'])
  })

  // Windows has no execute bit — there a name is a program when its extension says so — so this
  // is the one assertion that can only be made where the bit exists.
  it.skipIf(process.platform === 'win32')('takes a file with no execute bit for what it is: not a program', () => {
    const folder = temporary()
    writeFileSync(join(folder, 'code'), 'a note about code')
    chmodSync(join(folder, 'code'), 0o644)

    expect(linux({ path: [folder] })).toEqual([])
  })

  it('finds nothing, rather than guessing, on a desktop with none of them', () => {
    expect(linux({ path: [temporary()] })).toEqual([])
  })

  it('looks in the folders a desktop hides an editor in, which are on no GUI app’s PATH', () => {
    const folders = linuxEditorFolders('/home/boss')

    // Snap and flatpak are where Ubuntu and Fedora actually put one.
    expect(folders).toContain('/snap/bin')
    expect(folders).toContain('/var/lib/flatpak/exports/bin')
    // The JetBrains Toolbox writes its launchers here and adds the folder to no PATH.
    expect(folders).toContain(join('/home/boss', '.local', 'share', 'JetBrains', 'Toolbox', 'scripts'))
  })
})

describe('The editor in force', () => {
  it('is the first one found while the boss has picked nothing', () => {
    const editors = createEditors({
      store: memoryStore(),
      find: () => [installed('cursor'), installed('zed')],
      editorEnv: () => undefined,
    })

    expect(editors.state()).toEqual({
      found: [
        { id: 'cursor', name: 'Cursor' },
        { id: 'zed', name: 'Zed' },
      ],
      choice: null,
      using: 'cursor',
    })
  })

  it('honours $EDITOR where it names one of the editors found, and never runs it', () => {
    const editors = createEditors({
      store: memoryStore(),
      find: () => [installed('vscode'), installed('zed')],
      editorEnv: () => 'zed --wait',
    })

    expect(editors.state().using).toBe('zed')
    expect(editors.state().choice).toBe(null)
  })

  it('is the system default on a Mac with no editor at all', () => {
    const editors = createEditors({ store: memoryStore(), find: () => [], editorEnv: () => 'vim' })

    expect(editors.state()).toEqual({ found: [], choice: null, using: SYSTEM_DEFAULT })
  })

  it('follows the boss’s pick, over $EDITOR and over what came first', () => {
    const editors = createEditors({
      store: memoryStore(),
      find: () => [installed('vscode'), installed('cursor')],
      editorEnv: () => 'code',
    })

    expect(editors.choose('cursor').using).toBe('cursor')
    expect(editors.state().choice).toBe('cursor')
  })

  it('refuses anything that is not an editor it knows', () => {
    const editors = createEditors({ store: memoryStore(), find: () => [installed('vscode')] })

    expect(() => editors.choose('/bin/sh')).toThrow(/Unknown editor/)
  })

  it('tells every window once the boss has picked', () => {
    const seen: string[] = []
    const editors = createEditors({
      store: memoryStore(),
      find: () => [installed('vscode')],
      onChanged: (state) => seen.push(state.using),
    })

    editors.choose(SYSTEM_DEFAULT)

    expect(seen).toEqual([SYSTEM_DEFAULT])
  })
})

describe('Handing a file over', () => {
  it('gives the chosen editor’s bundle the path as an argument of its own', async () => {
    const handed: { app: string; path: string }[] = []
    const editors = createEditors({
      store: memoryStore('zed'),
      find: () => [installed('vscode'), installed('zed')],
      handOver: async (app, path) => {
        handed.push({ app, path })
        return true
      },
    })

    expect(await editors.open('/work/acme/a file.ts')).toBe(true)
    expect(handed).toEqual([{ app: application('Zed.app'), path: '/work/acme/a file.ts' }])
  })

  it('hands nothing over when the system default is the choice', async () => {
    const handed: string[] = []
    const editors = createEditors({
      store: memoryStore(SYSTEM_DEFAULT),
      find: () => [installed('vscode')],
      handOver: async (app) => {
        handed.push(app)
        return true
      },
    })

    expect(await editors.open('/work/acme/a.ts')).toBe(false)
    expect(handed).toEqual([])
  })

  it('says so when the editor would not start, so the caller can fall back', async () => {
    const editors = createEditors({
      store: memoryStore('vscode'),
      find: () => [installed('vscode')],
      handOver: async () => false,
    })

    expect(await editors.open('/work/acme/a.ts')).toBe(false)
  })
})

describe('The choice kept in userData', () => {
  it('persists across Companies: it is one file, read again by the next one', () => {
    const file = join(temporary(), 'settings', 'editor.json')
    const store = editorChoiceFile(file)

    createEditors({ store, find: () => [installed('vscode'), installed('zed')] }).choose('zed')

    const laterCompany = createEditors({
      store: editorChoiceFile(file),
      find: () => [installed('vscode'), installed('zed')],
      editorEnv: () => 'code',
    })
    expect(laterCompany.state()).toEqual({
      found: [
        { id: 'vscode', name: 'VS Code' },
        { id: 'zed', name: 'Zed' },
      ],
      choice: 'zed',
      using: 'zed',
    })
  })

  it('starts fresh when the file is missing, or holds something that is not a choice', () => {
    const folder = temporary()
    expect(editorChoiceFile(join(folder, 'nothing.json')).read()).toBe(null)

    const file = join(folder, 'editor.json')
    editorChoiceFile(file).write('cursor')
    expect(editorChoiceFile(file).read()).toBe('cursor')

    const store = editorChoiceFile(file)
    store.write(SYSTEM_DEFAULT)
    expect(store.read()).toBe(SYSTEM_DEFAULT)
  })
})
