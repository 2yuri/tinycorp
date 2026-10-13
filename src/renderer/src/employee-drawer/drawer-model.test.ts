import { describe, expect, it } from 'vitest'
import type { SkillRow } from '../../../shared/catalogue/skills'
import { COLUMNS, type Subtask, type Ticket } from '../../../shared/domain/board'
import {
  PROVIDER_CATALOGUE,
  PROVIDER_LABEL,
  PROVIDERS,
  type ProviderEntry,
  providerTables,
} from '../../../shared/domain/providers'
import {
  formatUptime,
  openTickets,
  providerMeta,
  roleLine,
  sessionMeta,
  skillsItem,
  startBlocked,
  subtaskProgress,
} from './drawer-model'

function ticket(id: number, fields: Partial<Ticket> = {}): Ticket {
  return {
    id,
    epicId: null,
    title: `Ticket ${id}`,
    description: '',
    column: 'todo',
    assigneeId: 'ada',
    repos: [],
    blocked: false,
    blockedReason: '',
    blockedBy: [],
    blocks: [],
    subtasks: [],
    priority: 'normal',
    labels: [],
    baseBranch: null,
    ...fields,
  }
}

const subtask = (id: number, done: boolean): Subtask => ({ id, ticketId: 1, title: `s${id}`, done, repo: null })

describe('Employee drawer model', () => {
  it('writes the role line from the title and capabilities', () => {
    expect(roleLine({ title: 'Tech Lead', capabilities: ['plan', 'code', 'review'] })).toBe(
      'Tech Lead · plan, code, review',
    )
    expect(roleLine({ title: 'Observer', capabilities: [] })).toBe('Observer')
  })

  it('formats uptime in minutes, hours and days, and nothing while off', () => {
    const start = '2026-09-17T08:00:00.000Z'
    const at = (minutes: number) => Date.parse(start) + minutes * 60_000 + 30_000

    expect(formatUptime(null, at(5))).toBeNull()
    expect(formatUptime(start, at(0))).toBe('0m')
    expect(formatUptime(start, at(12))).toBe('12m')
    expect(formatUptime(start, at(4 * 60 + 12))).toBe('4h 12m')
    expect(formatUptime(start, at(26 * 60))).toBe('1d 2h')
  })

  it('says the Session is live only while it runs', () => {
    expect(sessionMeta('busy')).toBe('Session live')
    expect(sessionMeta('idle')).toBe('Session live')
    expect(sessionMeta('off')).toBe('Session off')
  })

  it('picks the Employee’s open tickets, the one in progress first', () => {
    const tickets = [
      ticket(1, { column: 'todo' }),
      ticket(2, { column: 'done' }),
      ticket(3, { column: 'review' }),
      ticket(4, { column: 'doing' }),
      ticket(5, { column: 'doing', assigneeId: 'grace' }),
    ]

    expect(openTickets(tickets, 'ada').map((t) => t.id)).toEqual([4, 3, 1])
    expect(openTickets(tickets, 'nobody')).toEqual([])
  })

  it('puts a ticket still in Planning after the one being worked on (TI-2)', () => {
    const tickets = [
      ticket(1, { column: 'planning' }),
      ticket(2, { column: 'todo' }),
      ticket(3, { column: 'testing' }),
      ticket(4, { column: 'doing' }),
    ]

    expect(openTickets(tickets, 'ada').map((t) => t.id)).toEqual([4, 3, 2, 1])
  })

  it.each(COLUMNS.filter((column) => column !== 'doing' && column !== 'done'))(
    'keeps the ticket in Doing ahead of one in %s, whatever columns the board grows (TI-2)',
    (column) => {
      const tickets = [ticket(1, { column }), ticket(2, { column: 'doing' })]

      expect(openTickets(tickets, 'ada')[0]?.id).toBe(2)
    },
  )

  it('counts done subtasks', () => {
    expect(subtaskProgress(ticket(1, { subtasks: [subtask(1, true), subtask(2, true), subtask(3, false)] }))).toEqual({
      done: 2,
      total: 3,
      percent: (2 / 3) * 100,
    })
    expect(subtaskProgress(ticket(1))).toEqual({ done: 0, total: 0, percent: 0 })
  })
})

describe('the drawer width', () => {
  it('comes back the width the boss left it, and falls back when storage says nothing sane', async () => {
    const store = new Map<string, string>()
    ;(globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
      innerWidth: 1512,
    }
    const { rememberedWidth, rememberWidth, DRAWER_WIDTH } = await import('./drawer-width')
    expect(rememberedWidth(1512)).toBe(DRAWER_WIDTH)
    rememberWidth(620)
    expect(rememberedWidth(1512)).toBe(620)
    store.set('tinycorp.drawer.width', 'wide please')
    expect(rememberedWidth(1512)).toBe(DRAWER_WIDTH)
  })
})

describe('A Provider that is not on this machine', () => {
  it('says so on the meta strip instead of leaving the Start button to fail', () => {
    expect(providerMeta('codex', true)).toBe('Codex')
    expect(providerMeta('codex', false)).toBe('Codex — not installed')
    expect(providerMeta('claude', false)).toBe('Claude Code — not installed')
  })

  it('says why Start Session is out of reach, and nothing when it is not', () => {
    expect(startBlocked('claude', true)).toBeNull()
    expect(startBlocked('codex', false)).toContain('Codex is not installed on this Mac')
    expect(startBlocked('codex', false)).toContain('another Provider')
  })
})

/**
 * The drawer's skills item, against the real catalogue (T137): which Providers read skill folders
 * is the catalogue's answer, and the drawer never names a product of its own.
 */
describe('What the drawer says about an Employee’s skills', () => {
  const catalogue: SkillRow[] = [
    { id: 'sk1', name: 'review-checklist', path: '/Users/boss/skills/review-checklist', missing: false, employees: 1 },
    { id: 'sk2', name: 'pen-handoff', path: '/Users/boss/skills/pen-handoff', missing: true, employees: 1 },
  ]

  it('counts what an Employee holds on a Provider that reads them', () => {
    expect(skillsItem({ provider: 'claude', skills: ['sk1'] }, catalogue)).toBe('1 skill')
    expect(skillsItem({ provider: 'claude', skills: ['sk1', 'sk2'] }, catalogue)).toBe('2 skills · 1 missing')
  })

  /*
   * Every Provider in the catalogue reads skills since T253, so this drives the branch with a
   * table of its own rather than with whichever product happens to read none today — which is what
   * `folders` is injectable for. The line still has to exist: the day a Provider is added that
   * reads none, the Employee is told rather than shown a grant that reaches nothing.
   */
  it('says so on a Provider whose product reads no skills, rather than pretending', () => {
    const labels = { codex: 'Quiet' }
    const folders = { codex: null }

    expect(skillsItem({ provider: 'codex', skills: ['sk1'] }, catalogue, labels, folders)).toBe('Quiet — no skills')
  })

  it('says nothing about an Employee that holds none, on either kind of Provider', () => {
    expect(skillsItem({ provider: 'claude', skills: [] }, catalogue)).toBeNull()
    expect(skillsItem({ provider: 'codex', skills: [] }, catalogue, { codex: 'Quiet' }, { codex: null })).toBeNull()
  })

  it('ignores a grant the catalogue no longer holds', () => {
    expect(skillsItem({ provider: 'claude', skills: ['gone'] }, catalogue)).toBeNull()
  })
})

/**
 * The meta strip has a line for every Provider in the catalogue, whichever one an Employee was
 * hired on and whether or not its CLI is on this Mac — including one that does not exist yet.
 *
 * It is checked from the catalogue rather than from a list written here, because a Provider is an
 * entry and two lines (`docs/providers.md`) and the promise is that nothing else needs an edit.
 * The engine half of that promise is `src/main/engine/provider-registry.test.ts`; this is the half
 * the boss reads, and the two never import each other (T184).
 */
describe('The drawer’s Provider line', () => {
  it('names every Provider in the catalogue, and says when its CLI is missing', () => {
    for (const provider of PROVIDERS) {
      const label = PROVIDER_LABEL[provider]

      expect(providerMeta(provider, true, PROVIDER_LABEL)).toBe(label)
      expect(providerMeta(provider, false, PROVIDER_LABEL)).toBe(`${label} — not installed`)
      expect(startBlocked(provider, false, PROVIDER_LABEL)).toContain(`${label} is not installed`)
    }
  })

  it('names one that is not in the catalogue yet, with nothing here edited for it', () => {
    const next: ProviderEntry = {
      id: 'aider',
      name: 'Aider',
      shortName: 'Aider',
      command: 'aider',
      readsUsage: false,
      skillsFolder: null,
      icon: 'terminal',
      auth: { how: 'Its own login', signOut: 'aider logout', signIn: { args: ['login'], steps: [] } },
      maintainer: 'A stranger',
      models: [{ id: 'aider-default-balanced', label: 'Aider', model: 'aider-default', effort: 'medium' }],
    }
    const tables = providerTables([...PROVIDER_CATALOGUE, next])

    expect(providerMeta('aider' as never, true, tables.label)).toBe('Aider')
    expect(providerMeta('aider' as never, false, tables.label)).toBe('Aider — not installed')
    expect(startBlocked('aider' as never, false, tables.label)).toContain('Aider is not installed')
  })
})
