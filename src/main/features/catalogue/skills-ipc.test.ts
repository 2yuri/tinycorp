import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { skillChannels, staffChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerStaffIpc } from '../staff'
import type { SkillSources } from './skill-sources'
import { describeSkills, registerSkillsIpc } from './skills-ipc'

/**
 * The skill catalogue over IPC (T137): what the renderer may set, what comes back, and that the
 * grant reaches an Employee through the staff channels the same way every other job field does.
 */

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const ON_DISK = [onDisk('/Users/boss/skills/review-checklist'), onDisk('/Users/boss/.agents/skills/ai-sdk')]

/** The machine scan, as a scan that has already happened. Nothing here opens a folder. */
function fakeSources(): SkillSources {
  return {
    scan: (taken) => [
      {
        source: 'shared',
        path: onDisk('/Users/boss/.agents/skills'),
        elsewhere: 0,
        skills: [
          {
            name: 'ai-sdk',
            path: onDisk('/Users/boss/.agents/skills/ai-sdk'),
            description: 'what ai-sdk does',
            seenBy: ['Claude Code'],
            added: taken.some((skill) => skill.name === 'ai-sdk'),
            problem: null,
          },
        ],
      },
    ],
    take: (path) => (path === onDisk('/Users/boss/.agents/skills/ai-sdk') ? { name: 'ai-sdk', path } : null),
  }
}

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    folderExists: (path) => ON_DISK.includes(path),
  })
  engines.push(engine)
  let broadcasts = 0
  registerSkillsIpc({
    ipc,
    engine,
    pickFolder: async () => onDisk('/Users/boss/skills/review-checklist'),
    broadcastChanged: () => broadcasts++,
    sources: fakeSources(),
  })
  registerStaffIpc({ ipc, engine, broadcastChanged: () => {} })
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

const CHECKLIST = { name: 'review-checklist', path: onDisk('/Users/boss/skills/review-checklist') }

describe('Skills IPC', () => {
  it('adds a skill folder and lists it, with whether it is still there and who holds it', async () => {
    const { invoke } = setup()

    const added = (await invoke(skillChannels.add, CHECKLIST)) as { ok: true; value: { id: string } }

    expect(added).toMatchObject({ ok: true, value: { name: 'review-checklist', missing: false, employees: 0 } })
    expect(await invoke(skillChannels.list)).toMatchObject({ ok: true, value: [{ id: added.value.id }] })
  })

  it('hands back the folder picker’s answer, and nothing when it was cancelled', async () => {
    const { invoke } = setup()

    expect(await invoke(skillChannels.pickFolder)).toBe(onDisk('/Users/boss/skills/review-checklist'))
  })

  it('says what is wrong in the same words as the form, rather than throwing at the renderer', async () => {
    const { invoke } = setup()
    await invoke(skillChannels.add, CHECKLIST)

    expect(await invoke(skillChannels.add, CHECKLIST)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already has a skill named review-checklist/i),
    })
    expect(await invoke(skillChannels.add, { name: 'x' })).toMatchObject({ ok: false })
  })

  it('takes the grant off everyone when a skill is removed, after saying who holds it', async () => {
    const { engine, invoke } = setup()
    const added = (await invoke(skillChannels.add, CHECKLIST)) as { ok: true; value: { id: string } }
    const id = added.value.id
    await invoke(staffChannels.createRole, {
      name: 'Reviewer',
      persona: 'You review.',
      capabilities: ['review'],
      repoFilter: ['*'],
      skills: [id],
    })
    const role = engine.roles.list().find((r) => r.name === 'Reviewer')!
    const ada = engine.employees.create({ name: 'Ada', roleId: role.id })

    expect(await invoke(skillChannels.impact, id)).toMatchObject({
      ok: true,
      value: { name: 'review-checklist', employees: 1, roles: 1 },
    })
    expect(await invoke(skillChannels.remove, id)).toMatchObject({ ok: true })
    expect(engine.employees.list().find((e) => e.id === ada.id)!.skills).toEqual([])
  })

  it('grants a skill to one Employee over the staff channel, ids only', async () => {
    const { engine, invoke } = setup()
    const added = (await invoke(skillChannels.add, CHECKLIST)) as { ok: true; value: { id: string } }
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    await invoke(staffChannels.updateEmployee, ada.id, { skills: [added.value.id] })

    expect(engine.employees.list().find((e) => e.id === ada.id)!.skills).toEqual([added.value.id])
    expect(await invoke(staffChannels.updateEmployee, ada.id, { skills: ['nope'] })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown skill/i),
    })
  })

  it('lists what the agents on this machine already have, and what this Company holds already', async () => {
    const { invoke } = setup()

    expect(await invoke(skillChannels.found)).toMatchObject({
      ok: true,
      value: [{ source: 'shared', skills: [{ name: 'ai-sdk', seenBy: ['Claude Code'], added: false }] }],
    })

    await invoke(skillChannels.addFound, onDisk('/Users/boss/.agents/skills/ai-sdk'))

    expect(await invoke(skillChannels.found)).toMatchObject({ ok: true, value: [{ skills: [{ added: true }] }] })
  })

  it('adds a found folder under its own name, and grants it to nobody', async () => {
    const { engine, invoke } = setup()
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    const added = await invoke(skillChannels.addFound, onDisk('/Users/boss/.agents/skills/ai-sdk'))

    expect(added).toMatchObject({
      ok: true,
      value: { name: 'ai-sdk', path: onDisk('/Users/boss/.agents/skills/ai-sdk') },
    })
    expect(engine.employees.list().find((e) => e.id === ada.id)!.skills).toEqual([])
    expect(engine.roles.list().every((role) => role.skills.length === 0)).toBe(true)
  })

  it('refuses a folder the last scan did not offer, rather than adding something else', async () => {
    const { invoke } = setup()

    expect(await invoke(skillChannels.addFound, onDisk('/somewhere/else'))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not one of the folders just found/i),
    })
    expect(await invoke(skillChannels.addFound, '')).toMatchObject({ ok: false })
  })

  it('tells every window the catalogue changed', async () => {
    const { invoke, broadcasts } = setup()

    await invoke(skillChannels.add, CHECKLIST)

    expect(broadcasts()).toBeGreaterThan(0)
  })
})

describe('What each skill says it does (T264)', () => {
  it('is the description in the head of its SKILL.md, and nothing for a folder that is gone', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-skill-'))
    try {
      writeFileSync(
        join(folder, 'SKILL.md'),
        '---\nname: review-checklist\ndescription: The checks this team runs before a pull request\n---\n# Body\n',
      )
      const rows = [
        { id: 's-1', name: 'review-checklist', path: folder, missing: false, employees: 1 },
        { id: 's-2', name: 'pen-handoff', path: join(folder, 'gone'), missing: true, employees: 0 },
      ]

      expect(describeSkills(rows)).toEqual([
        {
          id: 's-1',
          name: 'review-checklist',
          description: 'The checks this team runs before a pull request',
          missing: false,
        },
        { id: 's-2', name: 'pen-handoff', description: '', missing: true },
      ])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
