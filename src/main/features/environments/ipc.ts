import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { environmentChannels } from '../../../shared/domain/channels'
import type { AskWhoIsThere } from '../../../shared/environments'
import {
  type EnvironmentId,
  type EnvironmentSettings,
  type ImportPreview,
  isEnvironmentId,
  parseEnvFile,
  revealFooter,
} from '../../../shared/environments'
import type { RevealedValue } from '../../../shared/ipc'
import { attempt, type IpcHandlerRegistry, isRecord, requireString } from '../../core'
import {
  backendProblem,
  type Clipboard,
  type ClipboardCopy,
  copyForAWhile,
  type SecretBackend,
  whereSecretsLive,
} from '../../platform'
import type { EnvironmentsFacade } from './facade'

/**
 * Company settings → Environments (T176). The only part of the app that ever holds a value besides
 * the runner, and it holds one for as long as it takes to hand it to the OS.
 *
 * Two things are deliberate here. Importing a `.env` reads the file **in this process** and sends
 * the renderer the keys only: the boss ticks names, and the values go from this module's memory
 * straight to the secret store without the renderer ever having seen one. And Reveal and Copy ask
 * the OS who is there first, every single time — there is no "remember me" and no session.
 */

export interface EnvironmentsIpcOptions {
  ipc: IpcHandlerRegistry
  engine: EnvironmentsFacade
  broadcastChanged(): void
  /** Asks the OS who is there before a value is shown or copied. */
  askWhoIsThere: AskWhoIsThere
  /** Where the boss picks a `.env`; null when they cancelled. */
  pickEnvFile(): Promise<string | null>
  clipboard: Clipboard
  /** Reads the chosen file. Injected so a test needs no file on disk. */
  readFile?: (path: string) => string
  /**
   * Which secret store this machine has (T176, T177). The main process is where `safeStorage`
   * lives, so this is where the answer comes from; the tab says where a value is kept and, on a
   * machine with no real store, why it will not keep one at all.
   */
  backend?: () => SecretBackend
  /** This machine's platform. Injected so a test can ask what each of the three would be told. */
  platform?: NodeJS.Platform
}

export function registerEnvironmentsIpc({
  ipc,
  engine,
  broadcastChanged,
  askWhoIsThere,
  pickEnvFile,
  clipboard,
  readFile = (path) => readFileSync(path, 'utf8'),
  backend = () => 'keychain',
  platform = process.platform,
}: EnvironmentsIpcOptions): void {
  engine.environments.onChange(broadcastChanged)

  /**
   * The values of the last file the boss previewed, per environment, kept only until they say what
   * to import. They never go to the renderer, and a new preview replaces the old one.
   */
  const previewed = new Map<EnvironmentId, Map<string, string>>()
  /** The copy in flight, so a second Copy takes the first one back rather than leaving it. */
  let copy: ClipboardCopy | null = null

  function settings(): EnvironmentSettings {
    return {
      environments: engine.environments.list(),
      variables: engine.environments.variables(),
      repos: engine.repos.list().map((repo) => ({
        id: repo.id,
        name: repo.name,
        defaultEnvironment: engine.environments.repoDefault(repo.id),
      })),
      storedAt: storedAt(),
      revealFooter: revealFooter(platform),
      storageProblem: backendProblem(backend()),
    }
  }

  /** Where the values are, in the one sentence the side panel shows (frame `zpvHQ`). */
  function storedAt(): string {
    const company = engine.currentCompany()
    return `Stored in ${whereSecretsLive(backend(), company?.name ?? 'this Company')}. Never in a repo, the database or a log.`
  }

  function environment(value: unknown): EnvironmentId {
    if (!isEnvironmentId(value)) throw new Error(`There is no environment named ${String(value)}`)
    return value
  }

  ipc.handle(environmentChannels.get, () => attempt(settings))

  ipc.handle(environmentChannels.setAskEveryUse, (_event, id, on) =>
    attempt(() => {
      engine.environments.setAskEveryUse(environment(id), on === true)
      return settings()
    }),
  )

  ipc.handle(environmentChannels.setAvailableToChecks, (_event, id, on) =>
    attempt(() => {
      engine.environments.setAvailableToChecks(environment(id), on === true)
      return settings()
    }),
  )

  ipc.handle(environmentChannels.add, (_event, input) =>
    attempt(() => {
      if (!isRecord(input)) throw new Error('Expected a variable')
      engine.environments.add({
        environment: environment(input['environment']),
        name: requireString(input['name'], 'name'),
        value: requireString(input['value'], 'value'),
        repoIds: repoIds(input['repoIds']),
      })
      return settings()
    }),
  )

  ipc.handle(environmentChannels.update, (_event, id, patch) =>
    attempt(() => {
      if (!isRecord(patch)) throw new Error('Expected the fields to change')
      engine.environments.update(requireString(id, 'variable'), {
        ...(patch['environment'] !== undefined && { environment: environment(patch['environment']) }),
        ...(patch['name'] !== undefined && { name: requireString(patch['name'], 'name') }),
        ...(patch['value'] !== undefined && { value: requireString(patch['value'], 'value') }),
        ...(patch['repoIds'] !== undefined && { repoIds: repoIds(patch['repoIds']) }),
      })
      return settings()
    }),
  )

  ipc.handle(environmentChannels.remove, (_event, id) =>
    attempt(() => {
      engine.environments.remove(requireString(id, 'variable'))
      return settings()
    }),
  )

  ipc.handle(environmentChannels.setRepoDefault, (_event, repoId, id) =>
    attempt(() => {
      engine.environments.setRepoDefault(
        requireString(repoId, 'repo'),
        id === null || id === undefined ? null : environment(id),
      )
      return settings()
    }),
  )

  ipc.handle(environmentChannels.reveal, async (_event, id) => {
    try {
      const variable = engine.environments.variables().find((row) => row.id === id)
      if (!variable) throw new Error('There is no such variable')
      const decision = await askWhoIsThere(`TinyCorp wants to reveal ${variable.name} (${variable.environment})`)
      if (!decision.ok) {
        return decision.cancelled
          ? { ok: false as const, error: 'Cancelled.' }
          : { ok: false as const, error: decision.error }
      }
      const revealed: RevealedValue = {
        name: variable.name,
        value: engine.environments.reveal(variable.id),
        protection: decision.protection,
      }
      return { ok: true as const, value: revealed }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipc.handle(environmentChannels.copy, async (_event, id) => {
    try {
      const variable = engine.environments.variables().find((row) => row.id === id)
      if (!variable) throw new Error('There is no such variable')
      const decision = await askWhoIsThere(`TinyCorp wants to copy ${variable.name} (${variable.environment})`)
      if (!decision.ok) {
        return decision.cancelled
          ? { ok: false as const, error: 'Cancelled.' }
          : { ok: false as const, error: decision.error }
      }
      await copy?.clear()
      copy = copyForAWhile(engine.environments.reveal(variable.id), { clipboard })
      return { ok: true as const, value: { protection: decision.protection } }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipc.handle(environmentChannels.pickEnvFile, async (_event, id) => {
    try {
      const into = environment(id)
      const path = await pickEnvFile()
      if (path === null) return { ok: true as const, value: null }
      // The file is read once, here, and never copied anywhere: the values stay in this map until
      // the boss says which keys to import, and the renderer is sent the keys alone.
      const text = readFile(path)
      previewed.set(into, new Map(parseEnvFile(text).map(({ name, value }) => [name, value])))
      const preview: ImportPreview = engine.environments.preview(shortName(path), into, text)
      return { ok: true as const, value: preview }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipc.handle(environmentChannels.importKeys, (_event, id, names) =>
    attempt(() => {
      const into = environment(id)
      const held = previewed.get(into)
      if (!held) throw new Error('Choose a .env file first.')
      // Not "…keys to import": electron-vite finds the last ESM import in the built chunk with a
      // regex, and a string that ends in `import'` looks like one — the CommonJS shim is then
      // written into the middle of this very literal and the whole main bundle stops parsing.
      if (!Array.isArray(names)) throw new Error('Expected a list of keys')
      const entries = names.map((name) => {
        const key = requireString(name, 'key')
        const value = held.get(key)
        if (value === undefined) throw new Error(`${key} was not in the file you chose.`)
        return { name: key, value }
      })
      engine.environments.importKeys(into, entries)
      // The file's values go the moment they are stored; nothing here keeps a copy around.
      previewed.delete(into)
      return settings()
    }),
  )
}

/** `web-app/.env.local`: the file, with the folder it is in, which is all the dialog needs to say. */
function shortName(path: string): string {
  // A label, not a path: the same `web/.env.local` on every platform.
  return `${basename(dirname(path))}/${basename(path)}`
}

function repoIds(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    throw new Error('The repos are a list of repo ids')
  }
  return value as string[]
}
