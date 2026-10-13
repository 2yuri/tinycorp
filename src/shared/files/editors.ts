import { machineWords } from '../platform/machine-words'

/**
 * Which editor a file is handed to (T123). The boss said `Open in editor` told them nothing: the
 * button now says the editor by name, and the list behind the chevron is what this Mac actually
 * has. The choice is the boss's own, kept in `userData` beside the boss profile, so every Company
 * opens files the same way (decision 47).
 */

/** The id the system default carries in the list and in the stored choice. */
export const SYSTEM_DEFAULT = 'system'

/** What the system default row says instead of a name. */
export const SYSTEM_DEFAULT_NAME = 'The system default'

/**
 * What an editor row says under its name once it has been found, on the platform the boss is on.
 * A Linux desktop is not a Mac, and the row saying so is the same honesty the Reveal footer keeps
 * (T177).
 */
export function foundHere(platform: NodeJS.Platform | string): string {
  return `found on ${machineWords(platform).machine}`
}

/** One editor the app knows: how to find it, how to hand it a file, how `$EDITOR` names it. */
export interface KnownEditor {
  id: string
  /** What the button says: `Open in VS Code`. */
  name: string
  /**
   * The bundle identifier its `Info.plist` carries, which is how a found `.app` is confirmed. It
   * is matched as a prefix, so one entry can cover a family that ships an identifier per product.
   */
  bundleId: string
  /**
   * Every command it installs, the one `$EDITOR` usually names first. On Linux and Windows this
   * is how it is found at all — an executable on `PATH` — and on a Mac it is only matched against
   * `$EDITOR`. Nothing here is ever run to find out whether it is there.
   */
  commands: readonly string[]
  /** The application bundles it ships as, looked for in this Mac's application folders. */
  apps: readonly string[]
}

/**
 * The editors the app knows by name, in the order the list shows them (design `CwBoJ`).
 *
 * `commands` carries the flatpak ids beside the plain names: a VS Code installed from flathub is
 * `com.visualstudio.code` in `/var/lib/flatpak/exports/bin` and nothing else, and a Linux boss who
 * installed it that way would otherwise be told they have no editor at all.
 *
 * JetBrains is one row rather than a dozen, because what the boss picks is "my JetBrains IDE" and
 * the app hands the file to whichever one is installed. The frame does not name it — it was drawn
 * before Linux was a target — so the row says the family's own name.
 */
export const KNOWN_EDITORS: readonly KnownEditor[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    bundleId: 'com.microsoft.VSCode',
    commands: ['code', 'code-insiders', 'com.visualstudio.code'],
    apps: ['Visual Studio Code.app'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    bundleId: 'com.todesktop.230313mzl4w4u92',
    commands: ['cursor', 'co.anysphere.cursor'],
    apps: ['Cursor.app'],
  },
  { id: 'zed', name: 'Zed', bundleId: 'dev.zed.Zed', commands: ['zed', 'zeditor', 'dev.zed.Zed'], apps: ['Zed.app'] },
  {
    id: 'jetbrains',
    name: 'JetBrains',
    // Every JetBrains IDE carries `com.jetbrains.<product>`, so the family is one prefix.
    bundleId: 'com.jetbrains.',
    commands: [
      'idea',
      'idea-ce',
      'webstorm',
      'pycharm',
      'pycharm-ce',
      'goland',
      'phpstorm',
      'rubymine',
      'clion',
      'rider',
      'datagrip',
      'rustrover',
    ],
    apps: [
      'IntelliJ IDEA.app',
      'IntelliJ IDEA Ultimate.app',
      'IntelliJ IDEA Community Edition.app',
      'WebStorm.app',
      'PyCharm.app',
      'PyCharm Professional.app',
      'PyCharm Community Edition.app',
      'GoLand.app',
      'PhpStorm.app',
      'RubyMine.app',
      'CLion.app',
      'Rider.app',
      'DataGrip.app',
      'RustRover.app',
    ],
  },
]

/** An editor found on this Mac, as the renderer sees it. The path to its bundle stays in main. */
export interface FoundEditor {
  id: string
  name: string
}

/** What the renderer needs to draw the button and its list. */
export interface EditorsState {
  /** Every known editor found on this Mac, in the catalogue's order. Empty on a Mac with none. */
  found: FoundEditor[]
  /** What the boss picked: an editor id, `system`, or null while they have picked nothing. */
  choice: string | null
  /**
   * What is in force right now, which is what the button says: an editor id, or `system`. With
   * nothing picked it is the editor `$EDITOR` names, else the first one found, else `system`.
   */
  using: string
}

/** One row of the `OPEN WITH` list. */
export interface EditorOption {
  id: string
  name: string
  /** The line under the name: where it was found, or what the system default means here. */
  detail: string
  /** The row with the tick: the one the button says. */
  chosen: boolean
}

/** What the button reads, by the name of the editor in force. */
export function editorLabel(state: EditorsState): string {
  const editor = state.found.find((one) => one.id === state.using)
  return editor ? `Open in ${editor.name}` : 'Open with the system default'
}

/**
 * What `The system default` means for the file at hand: `whatever opens a .ts today`. With no
 * file open, or one with no extension, it can only say the kind of thing it does.
 */
export function systemDefaultDetail(path: string | null | undefined): string {
  const extension = extensionOf(path)
  return extension ? `whatever opens a ${extension} today` : 'whatever opens this kind of file today'
}

/** The `OPEN WITH` list: what was found, then the system default, with a tick on the one in use. */
export function editorOptions(
  state: EditorsState,
  path: string | null = null,
  platform: NodeJS.Platform | string = 'darwin',
): EditorOption[] {
  const rows = state.found.map((one) => ({
    id: one.id,
    name: one.name,
    detail: foundHere(platform),
    chosen: one.id === state.using,
  }))
  return [
    ...rows,
    {
      id: SYSTEM_DEFAULT,
      name: SYSTEM_DEFAULT_NAME,
      detail: systemDefaultDetail(path),
      chosen: !rows.some((row) => row.chosen),
    },
  ]
}

/**
 * The editor `$EDITOR` names, when it is one of the editors found. `code -w` and
 * `/usr/local/bin/code` both name VS Code; nothing here is ever run as a command.
 */
export function editorNamedByEnv(found: readonly FoundEditor[], editor: string | null | undefined): string | null {
  const first = (editor ?? '').trim().split(/\s+/)[0] ?? ''
  const command = first.split('/').pop() ?? ''
  if (!command) return null
  const known = KNOWN_EDITORS.find((one) => one.commands.includes(command))
  return known && found.some((one) => one.id === known.id) ? known.id : null
}

/**
 * What opens a file right now. The boss's pick wins while the editor it names is still here; with
 * nothing picked the app chooses rather than leaving it vague — `$EDITOR`'s editor, else the first
 * one found — and with no editor at all it is the system default.
 */
export function editorInForce(found: readonly FoundEditor[], choice: string | null, editorEnv?: string | null): string {
  if (choice === SYSTEM_DEFAULT) return SYSTEM_DEFAULT
  if (choice !== null && found.some((one) => one.id === choice)) return choice
  return editorNamedByEnv(found, editorEnv) ?? found[0]?.id ?? SYSTEM_DEFAULT
}

/** Whether a value is something the boss could have picked: an editor the app knows, or `system`. */
export function isEditorChoice(value: unknown): value is string {
  return value === SYSTEM_DEFAULT || KNOWN_EDITORS.some((one) => one.id === value)
}

/** The extension the system default row names, `.ts` and all, or null when there is none. */
function extensionOf(path: string | null | undefined): string | null {
  const name = (path ?? '').split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : null
}
