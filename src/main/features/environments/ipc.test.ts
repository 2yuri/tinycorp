import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { environmentChannels } from '../../../shared/domain/channels'
import type { AskWhoIsThere, RevealDecision } from '../../../shared/environments'
import { CLIPBOARD_CLEAR_MS, type EnvironmentSettings, type ImportPreview } from '../../../shared/environments'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import type { Clipboard } from '../../platform/clipboard-copy'
import { NO_KEYRING_HERE, type SecretBackend } from '../../platform/safe-storage-secrets'
import { memorySecrets } from '../../platform/secrets'
import { registerEnvironmentsIpc } from './ipc'

/**
 * The Environments tab over IPC (T176). What the renderer may ask for, and what it may be told.
 *
 * Reveal and Copy are the two calls that can answer with a value, and both go through the OS
 * first. Import is the one that must not: the file is read here, and only its keys cross.
 */

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

const DATABASE_URL = 'postgres://app:h7fs8@db.internal:5432/billing'
const STRIPE_KEY = 'sk_live_9f2b7c1d4a'

const ENV_FILE = [
  '# the billing service',
  `DATABASE_URL=${DATABASE_URL}`,
  `STRIPE_SECRET_KEY=${STRIPE_KEY}`,
  'NEXT_PUBLIC_APP_URL=https://billing.example',
].join('\n')

function setup({
  decision = { ok: true, protection: 'touch-id' } as RevealDecision,
  file = '/code/web/.env.local' as string | null,
  text = ENV_FILE,
  platform = 'darwin' as NodeJS.Platform,
  // What `secretBackend()` would answer for that platform on a machine with a working store.
  backend = (platform === 'darwin' ? 'keychain' : platform === 'win32' ? 'dpapi' : 'libsecret') as SecretBackend,
} = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    secrets: memorySecrets(),
  })
  engines.push(engine)
  const asked: string[] = []
  const askWhoIsThere: AskWhoIsThere = async (reason) => {
    asked.push(reason)
    return decision
  }
  const clipboard: Clipboard & { text: string } = {
    text: '',
    readText() {
      return this.text
    },
    writeText(value) {
      this.text = value
    },
    clear() {
      this.text = ''
    },
  }
  let broadcasts = 0
  registerEnvironmentsIpc({
    ipc,
    engine,
    askWhoIsThere,
    clipboard,
    pickEnvFile: async () => file,
    readFile: () => text,
    platform,
    backend: () => backend,
    broadcastChanged: () => broadcasts++,
  })
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const billing = engine.repos.add({ path: onDisk('/code/billing'), name: 'billing-api', stack: readyStack() })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, asked, clipboard, billing, broadcasts: () => broadcasts }
}

/** The settings out of a successful call, with a readable failure when it was not one. */
function settingsOf(result: unknown): EnvironmentSettings {
  const answer = result as { ok: boolean; error?: string; value: EnvironmentSettings }
  if (!answer.ok) throw new Error(answer.error)
  return answer.value
}

describe('The Environments tab over IPC', () => {
  it('reads the three environments, their variables and the repos, with no value anywhere', async () => {
    const { invoke, billing } = setup()
    await invoke(environmentChannels.add, {
      environment: 'prod',
      name: 'DATABASE_URL',
      value: DATABASE_URL,
      repoIds: [billing.id],
    })

    const settings = settingsOf(await invoke(environmentChannels.get))

    expect(settings.environments.map((environment) => [environment.id, environment.askEveryUse])).toEqual([
      ['dev', false],
      ['staging', false],
      ['prod', true],
    ])
    expect(settings.variables).toEqual([
      expect.objectContaining({ name: 'DATABASE_URL', environment: 'prod', repoIds: [billing.id] }),
    ])
    expect(settings.repos).toEqual([{ id: billing.id, name: 'billing-api', defaultEnvironment: null }])
    expect(JSON.stringify(settings)).not.toContain('h7fs8')
  })

  it('turns the switches, and says where the values are kept', async () => {
    const { invoke } = setup()

    const off = settingsOf(await invoke(environmentChannels.setAskEveryUse, 'prod', false))
    const checks = settingsOf(await invoke(environmentChannels.setAvailableToChecks, 'dev', false))

    expect(off.environments.find((environment) => environment.id === 'prod')!.askEveryUse).toBe(false)
    expect(checks.environments.find((environment) => environment.id === 'dev')!.availableToChecks).toBe(false)
    expect(checks.storedAt).toMatch(/never in a repo, the database or a log/i)
  })

  it('says what protects Reveal, and where the values are, on each of the three platforms', async () => {
    const mac = settingsOf(await setup({ platform: 'darwin' }).invoke(environmentChannels.get))
    const windows = settingsOf(await setup({ platform: 'win32' }).invoke(environmentChannels.get))
    const linux = settingsOf(await setup({ platform: 'linux' }).invoke(environmentChannels.get))

    expect(mac.revealFooter).toMatch(/Touch ID/)
    expect(mac.storedAt).toMatch(/keychain/)
    expect(windows.revealFooter).toMatch(/ask you to confirm/)
    expect(windows.storedAt).toMatch(/DPAPI/)
    expect(linux.revealFooter).toMatch(/ask you to confirm/)
    expect(linux.storedAt).toMatch(/keyring/)
    // The promise a screen makes has to be one the platform can keep.
    expect(windows.revealFooter).not.toMatch(/Touch ID/)
    expect(linux.revealFooter).not.toMatch(/Touch ID/)
  })

  it('passes on why a desktop with no keyring cannot keep a secret', async () => {
    const { invoke } = setup({ platform: 'linux', backend: 'unprotected' })

    expect(settingsOf(await invoke(environmentChannels.get)).storageProblem).toBe(NO_KEYRING_HERE)
  })

  it('says nothing is wrong where the machine has a real store', async () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const { invoke } = setup({ platform })
      expect(settingsOf(await invoke(environmentChannels.get)).storageProblem).toBeNull()
    }
  })

  it('sets which environment a repo runs by default', async () => {
    const { invoke, billing } = setup()

    const settings = settingsOf(await invoke(environmentChannels.setRepoDefault, billing.id, 'staging'))

    expect(settings.repos[0]!.defaultEnvironment).toBe('staging')
  })

  it('adds a short value', async () => {
    const { invoke } = setup()

    const answer = (await invoke(environmentChannels.add, { environment: 'dev', name: 'PORT', value: '3000' })) as {
      ok: boolean
    }

    expect(answer.ok).toBe(true)
  })
})

describe('Reveal and Copy', () => {
  it('asks the OS who is there, then answers with the value and how it asked', async () => {
    const { invoke, asked } = setup()
    const added = settingsOf(
      await invoke(environmentChannels.add, { environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL }),
    )

    const answer = (await invoke(environmentChannels.reveal, added.variables[0]!.id)) as {
      ok: true
      value: { value: string; protection: string }
    }

    expect(asked).toEqual(['TinyCorp wants to reveal DATABASE_URL (prod)'])
    expect(answer.value).toEqual({ name: 'DATABASE_URL', value: DATABASE_URL, protection: 'touch-id' })
  })

  it('answers nothing at all when the boss cancels the prompt', async () => {
    const { invoke } = setup({ decision: { ok: false, cancelled: true } })
    const added = settingsOf(
      await invoke(environmentChannels.add, { environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL }),
    )

    const answer = (await invoke(environmentChannels.reveal, added.variables[0]!.id)) as {
      ok: boolean
      error: string
    }

    expect(answer).toEqual({ ok: false, error: 'Cancelled.' })
  })

  it('says how it asked, so an unprotected machine can say so out loud', async () => {
    const { invoke } = setup({ decision: { ok: true, protection: 'confirmation' } })
    const added = settingsOf(
      await invoke(environmentChannels.add, { environment: 'dev', name: 'DATABASE_URL', value: DATABASE_URL }),
    )

    const answer = (await invoke(environmentChannels.reveal, added.variables[0]!.id)) as {
      ok: true
      value: { protection: string }
    }

    expect(answer.value.protection).toBe('confirmation')
  })

  it('copies the value and takes it back thirty seconds later', async () => {
    const { invoke, clipboard, asked } = setup()
    const added = settingsOf(
      await invoke(environmentChannels.add, { environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL }),
    )

    await invoke(environmentChannels.copy, added.variables[0]!.id)

    expect(asked).toEqual(['TinyCorp wants to copy DATABASE_URL (prod)'])
    expect(clipboard.text).toBe(DATABASE_URL)
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS)
    expect(clipboard.text).toBe('')
  })

  it('never puts a value on the clipboard when the boss cancelled', async () => {
    const { invoke, clipboard } = setup({ decision: { ok: false, cancelled: true } })
    const added = settingsOf(
      await invoke(environmentChannels.add, { environment: 'prod', name: 'DATABASE_URL', value: DATABASE_URL }),
    )

    await invoke(environmentChannels.copy, added.variables[0]!.id)

    expect(clipboard.text).toBe('')
  })
})

describe('Import .env', () => {
  it('previews the keys of the chosen file and sends the renderer not one value', async () => {
    const { invoke } = setup()

    const answer = (await invoke(environmentChannels.pickEnvFile, 'staging')) as { ok: true; value: ImportPreview }

    expect(answer.value.file).toBe('web/.env.local')
    expect(answer.value.keys.map((key) => [key.name, key.chosen])).toEqual([
      ['DATABASE_URL', true],
      ['STRIPE_SECRET_KEY', true],
      ['NEXT_PUBLIC_APP_URL', false],
    ])
    expect(JSON.stringify(answer)).not.toContain('h7fs8')
    expect(JSON.stringify(answer)).not.toContain(STRIPE_KEY)
  })

  it('imports only the keys the boss ticked, with the values the renderer never saw', async () => {
    const { invoke, engine } = setup()
    await invoke(environmentChannels.pickEnvFile, 'staging')

    const settings = settingsOf(await invoke(environmentChannels.importKeys, 'staging', ['DATABASE_URL']))

    expect(settings.variables.map((variable) => variable.name)).toEqual(['DATABASE_URL'])
    expect(engine.environments.reveal(settings.variables[0]!.id)).toBe(DATABASE_URL)
  })

  it('forgets the file once it is imported, so a second import has to choose again', async () => {
    const { invoke } = setup()
    await invoke(environmentChannels.pickEnvFile, 'staging')
    await invoke(environmentChannels.importKeys, 'staging', ['DATABASE_URL'])

    const again = (await invoke(environmentChannels.importKeys, 'staging', ['STRIPE_SECRET_KEY'])) as {
      ok: boolean
      error: string
    }

    expect(again).toEqual({ ok: false, error: 'Choose a .env file first.' })
  })

  it('answers null when the boss closed the file dialog', async () => {
    const { invoke } = setup({ file: null })

    expect(await invoke(environmentChannels.pickEnvFile, 'staging')).toEqual({ ok: true, value: null })
  })
})
