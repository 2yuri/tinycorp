import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import { GENERATED_INSTRUCTIONS_MARKER } from '../../../shared/session'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { createClaudeAdapter, type PtySpawnOptions } from '../../providers/claude/adapter'
import type { PtySession } from '../../providers/provider-adapter'
import { READY_DELAY_MS } from './sessions'

/**
 * Every Employee of a Company shares its folder as their cwd, so identity may not travel through a
 * file there. These tests run the real Claude adapter over a fake PTY and read the argv each
 * process was actually given.
 */

interface Spawned {
  args: string[]
  options: PtySpawnOptions
}

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

/** One run of the app over a real Company folder, with the real Claude adapter. */
function launch(folder: string, notesFiles = inMemoryNotesFiles()) {
  const spawned: Spawned[] = []
  const adapter = createClaudeAdapter({
    hookUrl: 'http://127.0.0.1:4555/hook',
    dataDir: join(folder, '.app-data'),
    env: { PATH: '/usr/bin' },
    // `claude` is never run here: the PTY is fake, so the PATH lookup is answered for it.
    installed: () => true,
    spawnPty(_file, args, options) {
      spawned.push({ args, options })
      const pty: PtySession = {
        write() {},
        onData: () => () => {},
        onExit: () => () => {},
        kill() {},
        resize() {},
      }
      return pty
    },
  })
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    providers: { claude: adapter },
    notesFiles,
    log: () => {},
  })
  engines.push(engine)
  return { engine, spawned, notesFiles }
}

function scratchFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-identity-'))
  folders.push(folder)
  return folder
}

/** What a spawn put on `--append-system-prompt`. */
const systemPrompt = (spawned: Spawned) => spawned.args[spawned.args.indexOf('--append-system-prompt') + 1]!

/** The instructions each Employee's process was given, in start order. */
const promptsOf = (spawned: Spawned[]) => spawned.map(systemPrompt)

/** Every `# You are …` heading in one set of instructions. There must be exactly one. */
const identitiesIn = (text: string) => text.match(/^# You are .+$/gm) ?? []

function hire(engine: CompanyEngine, name: string, roleId = 'backend'): Employee {
  return engine.employees.create({ name, roleId })
}

describe('Two Employees, one Company folder', () => {
  it('gives each running Session its own identity, and nothing of the other’s', () => {
    const folder = scratchFolder()
    const { engine, spawned } = launch(folder)
    engine.createCompany({ folder, name: 'Gabriel' })
    const hera = hire(engine, 'Hera', 'pm')
    const orion = hire(engine, 'Orion', 'tech-lead')

    engine.sessions.start(hera.id)
    engine.sessions.start(orion.id)

    const [forHera, forOrion] = promptsOf(spawned) as [string, string]
    expect(identitiesIn(forHera)).toEqual(['# You are Hera, PM at Gabriel'])
    expect(identitiesIn(forOrion)).toEqual(['# You are Orion, Tech Lead at Gabriel'])
    expect(forHera).toContain('You are the project manager.')
    expect(forHera).not.toContain('You are the tech lead.')
    expect(forOrion).toContain('You are the tech lead.')
    expect(forOrion).not.toContain('You are the project manager.')
  })

  // The two files written here are T73's, so this is also the migration on the real path: the log
  // does not exist yet, the `.md` does, and what it held comes back in the Employee's own wake.
  it('names each Employee’s own role, capabilities and notes', () => {
    const folder = scratchFolder()
    const { engine, spawned, notesFiles } = launch(folder)
    engine.createCompany({ folder, name: 'Gabriel' })
    const hera = hire(engine, 'Hera', 'pm')
    const orion = hire(engine, 'Orion', 'tech-lead')
    notesFiles.write(join(folder, 'memory', `${hera.id}.md`), 'I run intake\n')
    notesFiles.write(join(folder, 'memory', `${orion.id}.md`), 'I review PRs\n')

    engine.sessions.start(hera.id)
    engine.sessions.start(orion.id)

    const [forHera, forOrion] = promptsOf(spawned) as [string, string]
    expect(forHera).toContain(join(folder, 'memory', hera.id, 'log'))
    expect(forHera).not.toContain(join(folder, 'memory', orion.id, 'log'))
    expect(forHera).toContain('I run intake')
    expect(forHera).not.toContain('I review PRs')
    expect(forOrion).toContain(join(folder, 'memory', orion.id, 'log'))
    expect(forOrion).not.toContain(join(folder, 'memory', hera.id, 'log'))
    expect(forOrion).toContain('I review PRs')
    expect(forOrion).not.toContain('I run intake')
    expect(forHera).toContain('`intake`')
    expect(forOrion).toContain('`review`')
  })

  it('keeps each identity apart for a team of five', () => {
    const folder = scratchFolder()
    const { engine, spawned } = launch(folder)
    engine.createCompany({ folder, name: 'Gabriel' })
    const names = ['Hera', 'Orion', 'Vesta', 'Atlas', 'Juno']
    const team = names.map((name) => hire(engine, name))

    for (const employee of team) engine.sessions.start(employee.id)

    expect(promptsOf(spawned).map(identitiesIn)).toEqual(names.map((name) => [`# You are ${name}, Backend at Gabriel`]))
    for (const [index, employee] of team.entries()) {
      const text = promptsOf(spawned)[index]!
      const others = team.filter((e) => e.id !== employee.id)
      expect(text).toContain(join(folder, 'memory', employee.id, 'log'))
      for (const other of others) expect(text).not.toContain(other.id)
    }
  })

  it('leaves no Employee-specific instructions file in the Company folder', () => {
    const folder = scratchFolder()
    const { engine } = launch(folder)
    engine.createCompany({ folder, name: 'Gabriel' })
    const hera = hire(engine, 'Hera', 'pm')
    const orion = hire(engine, 'Orion', 'tech-lead')

    engine.sessions.start(hera.id)
    engine.sessions.start(orion.id)

    expect(existsSync(join(folder, 'CLAUDE.md'))).toBe(false)
    expect(readdirSync(folder)).not.toContain('AGENTS.md')
  })

  it('deletes the shared CLAUDE.md an earlier build left behind', () => {
    const folder = scratchFolder()
    writeFileSync(join(folder, 'CLAUDE.md'), `# You are Arlo, PO at Gabriel\n\n${GENERATED_INSTRUCTIONS_MARKER}\n`)
    const { engine } = launch(folder)
    engine.createCompany({ folder, name: 'Gabriel' })
    const hera = hire(engine, 'Hera', 'pm')

    engine.sessions.start(hera.id)

    expect(existsSync(join(folder, 'CLAUDE.md'))).toBe(false)
  })

  it('gives each resumed Session its own identity after a restart', () => {
    const folder = scratchFolder()
    const notesFiles = inMemoryNotesFiles()
    const first = launch(folder, notesFiles)
    first.engine.createCompany({ folder, name: 'Gabriel' })
    const hera = hire(first.engine, 'Hera', 'pm')
    const orion = hire(first.engine, 'Orion', 'tech-lead')
    first.engine.sessions.start(hera.id)
    first.engine.sessions.start(orion.id)
    vi.advanceTimersByTime(READY_DELAY_MS)
    engines.splice(engines.indexOf(first.engine), 1)
    first.engine.close()

    const second = launch(folder, notesFiles)
    second.engine.openCompany(folder)

    const [forHera, forOrion] = promptsOf(second.spawned) as [string, string]
    expect(second.spawned.map((s) => s.args.includes('--resume'))).toEqual([true, true])
    expect(identitiesIn(forHera)).toEqual(['# You are Hera, PM at Gabriel'])
    expect(identitiesIn(forOrion)).toEqual(['# You are Orion, Tech Lead at Gabriel'])
    expect(forHera).toContain(join(folder, 'memory', hera.id, 'log'))
    expect(forHera).not.toContain(orion.id)
    expect(forOrion).toContain(join(folder, 'memory', orion.id, 'log'))
    expect(forOrion).not.toContain(hera.id)
    expect(existsSync(join(folder, 'CLAUDE.md'))).toBe(false)
  })
})
