import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { FilePlace } from '../../../shared/files/files'
import {
  type CodeSpot,
  type Defined,
  type Diagnosed,
  type Hovered,
  type LanguageReading,
  languageIdOf,
  NOTHING_KNOWN,
  type Outlined,
  type Severity,
} from '../../../shared/files/language'
import { createGitRunner, type ProcessRunner, runIn } from '../../platform'
import { createLspClient, type LspClient, type LspProcess, type UriTranslation } from './lsp-client'

/**
 * What the code viewer knows about the language (T115). One language server per place — a repo, or
 * an Employee's worktree, which is a project of its own — started the first time Files opens a
 * file it speaks for and stopped with the Company.
 *
 * It is the place's own TypeScript and never a bundled copy, so what the viewer says is what
 * `pnpm typecheck` says. A place with none, or one whose server will not start, is not an error:
 * the reading comes back with a reason for the quiet line under the file, and the viewer draws the
 * plain highlighted code it always did.
 *
 * Nothing here writes. The text a call carries is the boss's own, unsaved or not (T122), so the
 * server sees the file the viewer is showing rather than the one on disk.
 */

/** How a place's server is found and started; injected so tests need no TypeScript on disk. */
export interface LanguageDeps {
  /**
   * Starts the language server for a place's root. Null when the place has none of its own, which
   * is not a failure: the viewer degrades to plain highlighting. Throwing is a failure, and its
   * message is what the viewer says.
   */
  start(root: string): StartedServer | null
}

export interface StartedServer {
  process: LspProcess
  /** What the viewer calls it when it has something to say about it, e.g. `TypeScript 7.0.2`. */
  name: string
  /**
   * How a file URI is spelled on the server's side, when the server is not on this machine (T259).
   * Left out for a server on this machine, which is every Mac and every Linux desktop.
   */
  uris?: UriTranslation
}

export interface LanguageOptions {
  places(): FilePlace[]
  deps?: LanguageDeps
  /** How long any one question to a server may take. Starting one is given four times as long. */
  timeoutMs?: number
}

export interface LanguageReader {
  /** Everything about the file as a whole: what the server complains about, and its symbols. */
  read(placeId: string, path: string, text: string): Promise<LanguageReading>
  /** The type and the doc comment at a spot; null when the server knows nothing there. */
  hover(placeId: string, path: string, spot: CodeSpot, text: string): Promise<Hovered | null>
  /** Where the symbol at a spot is declared; null when nowhere, or nowhere readable. */
  definition(placeId: string, path: string, spot: CodeSpot, text: string): Promise<Defined | null>
  /** Stops every server. Called with the Company, and again is harmless. */
  stop(): void
}

/** A file no server speaks for: the viewer says as much, quietly, and highlights it anyway. */
export const NOT_A_LANGUAGE = 'No language server speaks for this file; it is highlighted, not read.'
/** A place with no TypeScript of its own. Never a bundled one: the viewer would disagree with the build. */
export const NO_SERVER = 'This repository has no TypeScript of its own, so there is nothing to read the types from.'

export function createLanguage({
  places,
  deps = typescriptServers,
  timeoutMs = 20_000,
}: LanguageOptions): LanguageReader {
  const servers = new Map<string, Server>()

  function placeOf(id: string): FilePlace {
    const place = places().find((candidate) => candidate.id === id)
    if (!place) throw new Error(`No repo or worktree called ${id} is open`)
    return place
  }

  /**
   * The place's server, started the first time it is wanted. A place that has none, and one whose
   * server would not start, is remembered as such and never tried again: the pointer must not keep
   * spawning a process that has already said no. A server that started and then died is given
   * another go or two, because a crash on one file should not take the whole afternoon with it.
   */
  function serverFor(place: FilePlace): Server {
    const had = servers.get(place.id)
    if (had && had.failed === null) return had
    if (had && (!had.died || had.starts >= START_ATTEMPTS)) return had
    const server = start(place, (had?.starts ?? 0) + 1)
    servers.set(place.id, server)
    return server
  }

  function start(place: FilePlace, starts: number): Server {
    const blank = { client: null, name: null, open: new Map<string, Open>(), ready: null, died: false, starts }
    let started: StartedServer | null
    try {
      started = deps.start(place.path)
    } catch (error) {
      return { ...blank, failed: reasonOf(error) }
    }
    if (started === null) return { ...blank, failed: NO_SERVER }
    const server: Server = { ...blank, failed: null, name: started.name }
    server.client = createLspClient({
      process: started.process,
      timeoutMs,
      ...(started.uris && { uris: started.uris }),
      onExit: (reason) => {
        server.failed = reason
        server.died = true
        server.open.clear()
      },
    })
    server.ready = initialize(server.client, place.path, timeoutMs * 4).catch((error: unknown) => {
      server.failed = reasonOf(error)
      throw error
    })
    return server
  }

  /**
   * The file as the server should see it: the boss's own text, opened the first time and changed
   * every time after, so a diagnostic follows what is in the editor and not what is on disk.
   */
  async function sync(place: FilePlace, path: string, text: string): Promise<Asked | string> {
    if (languageIdOf(path) === null) return NOT_A_LANGUAGE
    const server = serverFor(place)
    if (server.failed !== null) return server.failed
    if (server.client === null) return NO_SERVER
    try {
      await server.ready
    } catch (error) {
      return reasonOf(error)
    }
    if (server.failed !== null) return server.failed
    const uri = pathToFileURL(resolve(place.path, path)).href
    const had = server.open.get(uri)
    if (had === undefined) {
      server.open.set(uri, { version: 1, text })
      server.client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: languageIdOf(path), version: 1, text },
      })
    } else if (had.text !== text) {
      had.version += 1
      had.text = text
      server.client.notify('textDocument/didChange', {
        textDocument: { uri, version: had.version },
        contentChanges: [{ text }],
      })
    }
    return { client: server.client, uri }
  }

  return {
    async read(id, path, text) {
      const place = placeOf(id)
      const asked = await sync(place, path, text)
      if (typeof asked === 'string') return { ...NOTHING_KNOWN, status: statusOf(asked), reason: asked }
      const [diagnostics, outline] = await Promise.all([
        ask(asked, 'textDocument/diagnostic', { textDocument: { uri: asked.uri } }),
        ask(asked, 'textDocument/documentSymbol', { textDocument: { uri: asked.uri } }),
      ])
      if (diagnostics.error !== null) return { ...NOTHING_KNOWN, status: 'failed', reason: diagnostics.error }
      return {
        status: 'ready',
        reason: null,
        diagnostics: diagnosedOf(diagnostics.value),
        outline: outlinedOf(outline.value),
      }
    },

    async hover(id, path, spot, text) {
      const place = placeOf(id)
      const asked = await sync(place, path, text)
      if (typeof asked === 'string') return null
      const answer = await ask(asked, 'textDocument/hover', {
        textDocument: { uri: asked.uri },
        position: positionOf(spot),
      })
      return hoveredOf(answer.value, spot)
    },

    async definition(id, path, spot, text) {
      const place = placeOf(id)
      const asked = await sync(place, path, text)
      if (typeof asked === 'string') return null
      const answer = await ask(asked, 'textDocument/definition', {
        textDocument: { uri: asked.uri },
        position: positionOf(spot),
      })
      const target = targetOf(answer.value)
      return target === null ? null : definedAt(target, places(), place)
    },

    stop() {
      for (const [, server] of servers) server.client?.stop()
      servers.clear()
    },
  }
}

/** How many times a place's server may be started before the viewer stops asking for one. */
export const START_ATTEMPTS = 3

/** One file as the server was last told it stands. */
interface Open {
  version: number
  text: string
}

/** One place's server: the client while it lives, or why it does not. */
interface Server {
  client: LspClient | null
  /** Why the viewer has nothing to say for this place; null while it has. */
  failed: string | null
  name: string | null
  /** Every file the server has been told about, and what it was last told it holds. */
  open: Map<string, Open>
  ready: Promise<unknown> | null
  /** True when this one started and then died, which is worth another go; a refusal is not. */
  died: boolean
  /** Which attempt this is, so a server that dies over and over is eventually left alone. */
  starts: number
}

interface Asked {
  client: LspClient
  uri: string
}

/** A question whose failure is a reason and not a throw: the viewer degrades, it never breaks. */
async function ask(asked: Asked, method: string, params: unknown): Promise<{ value: unknown; error: string | null }> {
  try {
    return { value: await asked.client.request(method, params), error: null }
  } catch (error) {
    return { value: null, error: reasonOf(error) }
  }
}

async function initialize(client: LspClient, root: string, timeoutMs: number): Promise<void> {
  const uri = pathToFileURL(root).href
  await Promise.race([
    client.request('initialize', {
      processId: process.pid,
      rootUri: uri,
      workspaceFolders: [{ uri, name: root.slice(root.lastIndexOf(sep) + 1) }],
      // Only what the viewer draws is asked for: it reads, so nothing here can be applied back.
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        textDocument: {
          synchronization: { didSave: false },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          diagnostic: { dynamicRegistration: false },
          publishDiagnostics: { versionSupport: true },
        },
      },
    }),
    // A server that never finishes starting is a failure with a reason, not a viewer that hangs.
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('The language server did not start in time')), timeoutMs).unref?.(),
    ),
  ])
  client.notify('initialized', {})
}

function statusOf(reason: string): LanguageReading['status'] {
  return reason === NOT_A_LANGUAGE || reason === NO_SERVER ? 'none' : 'failed'
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A spot as the viewer numbers it, as LSP numbers it: both from zero. */
export function positionOf(spot: CodeSpot): { line: number; character: number } {
  return { line: Math.max(0, spot.line - 1), character: Math.max(0, spot.column - 1) }
}

/** …and back, for everything the server hands over. */
export function spotOf(position: unknown): CodeSpot {
  const at = position as { line?: number; character?: number } | null
  return { line: (at?.line ?? 0) + 1, column: (at?.character ?? 0) + 1 }
}

const SEVERITIES: Record<number, Severity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' }

/** What the server complains about, as the viewer marks it. */
export function diagnosedOf(answer: unknown): Diagnosed[] {
  const report = answer as { items?: unknown[] } | unknown[] | null
  const items = Array.isArray(report) ? report : (report?.items ?? [])
  return items.flatMap((item): Diagnosed[] => {
    const one = item as {
      range?: { start?: unknown; end?: unknown }
      severity?: number
      message?: string
      code?: string | number
    }
    if (typeof one?.message !== 'string') return []
    const start = spotOf(one.range?.start)
    const end = spotOf(one.range?.end)
    return [
      {
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
        severity: SEVERITIES[one.severity ?? 1] ?? 'error',
        message: one.message,
        code: one.code === undefined ? null : String(one.code),
      },
    ]
  })
}

/** The LSP symbol kinds, in the words the outline puts beside a symbol. */
const SYMBOL_KINDS: Record<number, string> = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  20: 'key',
  21: 'null',
  22: 'member',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'type',
}

/**
 * What a symbol has to be for the outline to go on and list what is inside it. A function's own
 * locals and the callbacks it passes are not the file's symbols — they are its workings, and a
 * list of them is no way to find anything in a long file.
 */
const HOLDS_SYMBOLS = new Set(['class', 'interface', 'enum', 'module', 'namespace', 'struct', 'object', 'type'])

/**
 * The file's symbols, flattened to a depth the outline can indent by. Both shapes the protocol
 * allows come back the same way: nested `DocumentSymbol`s, and the flat `SymbolInformation` list
 * an older server answers with.
 */
export function outlinedOf(answer: unknown, depth = 0): Outlined[] {
  if (!Array.isArray(answer)) return []
  return answer.flatMap((item): Outlined[] => {
    const one = item as {
      name?: string
      kind?: number
      selectionRange?: { start?: unknown }
      range?: { start?: unknown }
      location?: { range?: { start?: unknown } }
      children?: unknown
    }
    if (typeof one?.name !== 'string') return []
    const start = one.selectionRange?.start ?? one.range?.start ?? one.location?.range?.start
    const spot = spotOf(start)
    const kind = SYMBOL_KINDS[one.kind ?? 0] ?? 'symbol'
    return [
      { name: one.name, kind, line: spot.line, column: spot.column, depth },
      ...(HOLDS_SYMBOLS.has(kind) ? outlinedOf(one.children, depth + 1) : []),
    ]
  })
}

/**
 * A hover as the card draws it: the signature out of its code fence, and the doc comment under it.
 * Every shape the protocol allows for `contents` is read; a hover with no range is about the spot
 * the pointer was on.
 */
export function hoveredOf(answer: unknown, spot: CodeSpot): Hovered | null {
  const hover = answer as { contents?: unknown; range?: { start?: unknown; end?: unknown } } | null
  const text = markdownOf(hover?.contents).trim()
  if (text === '') return null
  const fences = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  const signature = fences
    .map((fence) => fence[1]!.trim())
    .join('\n')
    .trim()
  const docs = text.replace(/```[^\n]*\n[\s\S]*?```/g, '').trim()
  // Some servers answer in plain text with no fence at all; then the whole of it is the signature.
  if (signature === '') return { signature: docs, docs: null, range: rangeOf(hover?.range, spot) }
  return { signature, docs: docs === '' ? null : docs, range: rangeOf(hover?.range, spot) }
}

function markdownOf(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(markdownOf).join('\n')
  const marked = contents as { value?: unknown; language?: unknown } | null
  if (typeof marked?.value !== 'string') return ''
  // The old `MarkedString` shape: a language and a bare string, which is a fenced block really.
  return typeof marked.language === 'string' ? `\`\`\`${marked.language}\n${marked.value}\n\`\`\`` : marked.value
}

function rangeOf(range: { start?: unknown; end?: unknown } | undefined, spot: CodeSpot) {
  if (!range) return { line: spot.line, column: spot.column, endLine: spot.line, endColumn: spot.column + 1 }
  const start = spotOf(range.start)
  const end = spotOf(range.end)
  return { line: start.line, column: start.column, endLine: end.line, endColumn: end.column }
}

/** The one place a definition answer points at; the first, when the server names several. */
export function targetOf(answer: unknown): { uri: string; spot: CodeSpot } | null {
  const first = Array.isArray(answer) ? answer[0] : answer
  const one = first as
    | { uri?: string; targetUri?: string; range?: { start?: unknown }; targetSelectionRange?: { start?: unknown } }
    | null
    | undefined
  const uri = one?.uri ?? one?.targetUri
  if (typeof uri !== 'string') return null
  return { uri, spot: spotOf(one?.targetSelectionRange?.start ?? one?.range?.start) }
}

/**
 * Where a definition lands: a file of a place is opened in it, and one nowhere the Company owns —
 * a `.d.ts` in `node_modules`, the library itself — opens by its whole path as a tab of its own
 * (T121). The place the click came from wins a file two places both hold, so following a symbol
 * inside a worktree stays in that worktree.
 */
export function definedAt(
  target: { uri: string; spot: CodeSpot },
  places: readonly FilePlace[],
  from: FilePlace,
): Defined {
  let full: string
  try {
    full = fileURLToPath(target.uri)
  } catch {
    full = target.uri
  }
  for (const place of [from, ...places.filter((one) => one.id !== from.id)]) {
    const inside = relative(place.path, full)
    if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) {
      return {
        placeId: place.id,
        path: inside.split(sep).join('/'),
        line: target.spot.line,
        column: target.spot.column,
      }
    }
  }
  return { placeId: null, path: full, line: target.spot.line, column: target.spot.column }
}

/**
 * The real thing: the place's own TypeScript, run as a language server. Walked up from the place's
 * root the way Node resolves it, so a worktree with no `node_modules` of its own still finds the
 * repo's. Nothing is bundled — a place with no TypeScript gets no server, and says so.
 */
export const typescriptServers: LanguageDeps = {
  start(root) {
    const found = typescriptAt(root)
    if (found === null) return null
    const runner = createGitRunner().runtimeFor(root)
    if (runner.kind === 'wsl') return inDistro(root, found, runner.distro)
    const child = spawn(process.execPath, [found.bin, '--lsp', '--stdio'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Electron's own binary is the Node here; this is what makes it run as one.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    return { process: child as unknown as LspProcess, name: `TypeScript ${found.version}` }
  },
}

/**
 * The place's own TypeScript, run by the **distro's** Node (T259).
 *
 * Not Electron-as-Node: `process.execPath` is a Windows `.exe`, and a Linux process is what a
 * worktree inside a distro needs — `node_modules` there was installed against that distro's libc, and
 * the server resolves every path it is given as a Linux one. The distro's login shell finds `node`,
 * which is what an nvm or a `~/.local/bin` install needs (the same reason every Session is started
 * through `sh -lc`).
 *
 * A distro with no `node` on its login `PATH` is a place with no server: the shell exits non-zero,
 * the client says the server died, and the viewer draws the plain highlighted code it always did —
 * which is exactly what a place with no TypeScript already does.
 *
 * `typescriptAt` still walks over the share with `node:fs`, because this process can read it and
 * reading a folder listing is not worth a `wsl.exe` each time; only the path it found is translated.
 */
function inDistro(root: string, found: { bin: string; version: string }, distro: string): StartedServer {
  const runner = runIn({ kind: 'wsl', distro })
  const child = runner.spawn('node', [runner.toRuntime(found.bin), '--lsp', '--stdio'], { cwd: root })
  return {
    process: child as unknown as LspProcess,
    name: `TypeScript ${found.version}`,
    uris: distroUris(runner),
  }
}

/**
 * The two spellings of one file URI, across the app and a distro.
 *
 * It goes through the path rather than editing the URI's text, because that is the only way the
 * drive case is right: `file:///mnt/d/code/x.ts` inside the distro is `file:///D:/code/x.ts` here,
 * and no amount of prefix-swapping turns one into the other. A URI that is not a `file:` one — and
 * `node:` and `untitled:` both occur — is handed back untouched.
 */
export function distroUris(runner: Pick<ProcessRunner, 'toRuntime' | 'toHost'>): UriTranslation {
  const cross = (uri: string, translate: (path: string) => string): string => {
    if (!uri.startsWith('file:')) return uri
    try {
      return pathToFileURL(translate(fileURLToPath(uri))).href
    } catch {
      return uri
    }
  }
  return {
    toServer: (uri) => cross(uri, runner.toRuntime),
    toHost: (uri) => cross(uri, runner.toHost),
  }
}

/** The nearest `node_modules/typescript` at or above a folder, and the version it says it is. */
export function typescriptAt(root: string): { bin: string; version: string } | null {
  for (let folder = resolve(root); ; folder = dirname(folder)) {
    const bin = join(folder, 'node_modules', 'typescript', 'bin', 'tsc')
    if (existsSync(bin)) return { bin, version: versionAt(join(folder, 'node_modules', 'typescript')) }
    if (dirname(folder) === folder) return null
  }
}

function versionAt(pkg: string): string {
  try {
    return String(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}
