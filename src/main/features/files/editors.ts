import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  type EditorsState,
  editorInForce,
  type FoundEditor,
  isEditorChoice,
  KNOWN_EDITORS,
  type KnownEditor,
  SYSTEM_DEFAULT,
} from '../../../shared/files/editors'
import { resolveCli } from '../../platform'

/** Where a Mac keeps its applications. Nothing outside these folders is looked at. */
export const APPLICATION_FOLDERS = ['/Applications', '/Applications/Utilities', '/System/Applications']

/**
 * The folders a Linux desktop puts an editor's launcher in that are not always on a GUI app's
 * `PATH` (T177). They are searched **as well as** `PATH`, which `adoptLoginShellPath` has already
 * widened with the login shell's own by the time this runs.
 *
 * Snap and flatpak are the two that matter: a VS Code from the Ubuntu store is `/snap/bin/code`
 * and one from flathub is `/var/lib/flatpak/exports/bin/com.visualstudio.code`, and neither folder
 * is on the `PATH` a `.desktop` launch inherits. The JetBrains Toolbox writes its shell scripts
 * into `~/.local/share/JetBrains/Toolbox/scripts`, which is on no `PATH` at all until the boss
 * adds it.
 */
export function linuxEditorFolders(home = homedir()): string[] {
  return [
    '/usr/bin',
    '/usr/local/bin',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    join(home, '.local', 'bin'),
    join(home, '.local', 'share', 'flatpak', 'exports', 'bin'),
    join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts'),
  ]
}

/** An editor found on this machine: a `.app` on a Mac, an executable everywhere else. */
export interface InstalledEditor extends FoundEditor {
  /** The bundle or the executable itself, which is what the file is handed to. */
  app: string
}

/** Where the boss's choice is kept: a file in `userData`, beside the boss profile (decision 47). */
export interface EditorChoiceStore {
  /** The stored choice, or null while the boss has picked nothing. */
  read(): string | null
  write(choice: string): void
}

/** Reading a bundle's `Info.plist`; null when there is none to read. */
export type ReadBundleFile = (path: string) => string | null

export interface FindEditorsOptions {
  folders?: readonly string[]
  /** The home folder whose own `Applications` is looked in too. */
  home?: string
  readFile?: ReadBundleFile
  /** Which way of looking is used: bundles on a Mac, executables on Windows and Linux. */
  platform?: NodeJS.Platform
  /** Off macOS: the environment the `PATH` search reads. Injected so a test needs no editor. */
  env?: NodeJS.ProcessEnv
  /**
   * Off macOS: the folders searched as well as `PATH`. Defaults to {@link linuxEditorFolders};
   * a test hands in its own so the answer is about the fixture and not about this machine.
   */
  alsoLookIn?: readonly string[]
}

/**
 * Every editor the app knows, found by looking for the application itself.
 *
 * On a Mac that is an `.app` in one of this Mac's application folders whose `Info.plist` carries
 * the bundle id we know it by. Everywhere else it is an executable on `PATH` — plus the folders a
 * Linux desktop hides one in ({@link linuxEditorFolders}) — resolved through the same
 * `cli-command.ts` that finds the Provider CLIs, so a `.cmd` shim on Windows is understood the way
 * it is everywhere else in the app.
 *
 * Nothing is run to find out: no shell string, no `which` output read loosely.
 */
export function findEditors({
  folders = APPLICATION_FOLDERS,
  home = homedir(),
  readFile = readBundleFile,
  platform = process.platform,
  env = process.env,
  alsoLookIn = linuxEditorFolders(home),
}: FindEditorsOptions = {}): InstalledEditor[] {
  const where = [...folders, join(home, 'Applications')]
  const searching = searchEnv(env, platform, alsoLookIn)
  const found: InstalledEditor[] = []
  for (const editor of KNOWN_EDITORS) {
    const app =
      platform === 'darwin' ? firstBundle(editor, where, readFile) : firstExecutable(editor, searching, platform)
    if (app !== null) found.push({ id: editor.id, name: editor.name, app })
  }
  return found
}

/** `PATH` with the folders a Linux desktop hides an editor in appended, each folder once. */
function searchEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  alsoLookIn: readonly string[],
): NodeJS.ProcessEnv {
  if (platform !== 'linux') return env
  const seen = new Set((env['PATH'] ?? '').split(delimiter).filter(Boolean))
  for (const folder of alsoLookIn) seen.add(folder)
  return { ...env, PATH: [...seen].join(delimiter) }
}

/** The first of this editor's commands that is really on this machine, or null when none is. */
function firstExecutable(editor: KnownEditor, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  for (const command of editor.commands) {
    const path = resolveCli(command, env, platform)
    if (path !== null) return path
  }
  return null
}

/** The first bundle of this editor that is really there, or null when none of them is. */
function firstBundle(editor: KnownEditor, folders: readonly string[], readFile: ReadBundleFile): string | null {
  for (const folder of folders) {
    for (const name of editor.apps) {
      const app = join(folder, name)
      const plist = readFile(join(app, 'Contents', 'Info.plist'))
      if (plist !== null && plist.includes(editor.bundleId)) return app
    }
  }
  return null
}

/**
 * A bundle's `Info.plist` as text. It comes as XML or as a binary plist, and the bundle id is a
 * plain string in both, so the bytes are read as latin1 and searched rather than parsed.
 */
function readBundleFile(path: string): string | null {
  try {
    return readFileSync(path, 'latin1')
  } catch {
    return null
  }
}

/** Hands a file to an application. Returns false when it would not start. */
export type HandOver = (app: string, path: string) => Promise<boolean>

export interface EditorsOptions {
  store: EditorChoiceStore
  /** Defaults to looking through this Mac's application folders; tests hand one in. */
  find?: () => InstalledEditor[]
  /** `$EDITOR`, honoured only where it names one of the editors found. */
  editorEnv?: () => string | undefined
  /** Defaults to this platform's opener; tests count instead of launching. */
  handOver?: HandOver
  platform?: NodeJS.Platform
  /** Called whenever the boss picks another editor, so every window can redraw the button. */
  onChanged?(state: EditorsState): void
}

/**
 * The one place that knows which editor opens a file (T123). It owns what was found on this Mac
 * and the boss's choice, and hands files over. Every Company reads the same one.
 */
export interface Editors {
  state(): EditorsState
  /** The boss picked a row of the `OPEN WITH` list: an editor id, or `system`. */
  choose(id: string): EditorsState
  /**
   * Hands the file to the editor in force. False when that is the system default, or when the
   * editor would not start — the caller then falls back to whatever the system opens it with.
   */
  open(path: string): Promise<boolean>
}

export function createEditors({
  store,
  find = () => findEditors(),
  editorEnv = () => process.env['EDITOR'],
  platform = process.platform,
  handOver = platform === 'darwin' ? openWithApp : startWithExecutable,
  onChanged,
}: EditorsOptions): Editors {
  const installed = find()
  const found: FoundEditor[] = installed.map((one) => ({ id: one.id, name: one.name }))
  const stored = store.read()
  let choice = stored !== null && isEditorChoice(stored) ? stored : null

  const state = (): EditorsState => ({
    found: found.map((one) => ({ ...one })),
    choice,
    using: editorInForce(found, choice, editorEnv()),
  })

  return {
    state,
    choose(id) {
      if (!isEditorChoice(id)) throw new Error(`Unknown editor: ${String(id)}`)
      choice = id
      store.write(id)
      const next = state()
      onChanged?.(next)
      return next
    },
    async open(path) {
      const using = editorInForce(found, choice, editorEnv())
      if (using === SYSTEM_DEFAULT) return false
      const editor = installed.find((one) => one.id === using)
      return editor ? handOver(editor.app, path) : false
    },
  }
}

/**
 * macOS's own opener, given the bundle we found and the path as an argument of its own. Never a
 * shell string: nothing in a path can be read as a flag.
 */
function openWithApp(app: string, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', app, path], (error) => resolve(!error))
  })
}

/**
 * Windows and Linux have no `open -a`: the editor *is* the executable, so it is started with the
 * file as its one argument (T177).
 *
 * Detached and `unref`ed, because the editor outlives TinyCorp — closing the office must not close
 * the window the boss is reading. And answered on `spawn` rather than on exit: `code` forks a
 * window and leaves immediately, `zed` does not, and waiting for either to finish would hang the
 * button on one of them.
 */
function startWithExecutable(app: string, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(app, [path], { detached: true, stdio: 'ignore' })
    child.on('spawn', () => {
      child.unref()
      resolve(true)
    })
    // Nothing started: the caller falls back to whatever the system opens the file with.
    child.on('error', () => resolve(false))
  })
}
