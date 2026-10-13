// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkillFoundGroup } from '../../../shared/catalogue/skill-sources'
import type { SkillRow } from '../../../shared/catalogue/skills'

/**
 * Skills found on this machine (T253, frame `LBKv1`).
 *
 * The card is handed folders and sends back a folder. What these tests watch is the three things
 * a row can be — one to add, one already in the Company, one whose name is taken by another folder
 * — that a long group keeps its length to itself until asked, that the plugins' group opens shut,
 * and that adding one is adding it to the catalogue and to nobody's Employee.
 */

const skill = (name: string, path: string, rest: Partial<SkillFoundGroup['skills'][number]> = {}) => ({
  name,
  path,
  description: `what ${name} does`,
  seenBy: [],
  added: false,
  problem: null,
  ...rest,
})

const GROUPS: SkillFoundGroup[] = [
  {
    source: 'shared',
    path: '/Users/boss/.agents/skills',
    elsewhere: 0,
    skills: [
      skill('ai-sdk', '/Users/boss/.agents/skills/ai-sdk', { seenBy: ['Claude Code'] }),
      skill('agent-browser', '/Users/boss/.agents/skills/agent-browser', { added: true }),
      skill('review-checklist', '/Users/boss/.agents/skills/review-checklist', {
        problem: 'This Company already has a skill named review-checklist',
      }),
      skill('atlas', '/Users/boss/.agents/skills/atlas'),
      skill('biome', '/Users/boss/.agents/skills/biome'),
    ],
  },
  {
    source: 'claude-code',
    path: '/Users/boss/.claude/skills',
    elsewhere: 79,
    skills: [skill('typescript-expert', '/Users/boss/.claude/skills/typescript-expert')],
  },
  {
    source: 'plugins',
    path: '/Users/boss/.claude/plugins',
    elsewhere: 0,
    skills: [skill('deploy-runbook', '/Users/boss/.claude/plugins/cache/acme/tools/1.0.0/skills/deploy-runbook')],
  },
]

const ROW: SkillRow = {
  id: 'added',
  name: 'ai-sdk',
  path: '/Users/boss/.agents/skills/ai-sdk',
  missing: false,
  employees: 0,
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.assign(window, { tinyCorp: { skills: {} } })

let host: HTMLElement | null = null
let mounted: Root | null = null
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = null
  host?.remove()
  host = null
})

async function open(groups: SkillFoundGroup[] | { error: string } = GROUPS, query = '') {
  const added: string[] = []
  const counts: number[] = []
  const { SkillsFoundCard } = await import('./SkillsFound')
  host = document.createElement('div')
  document.body.append(host)
  mounted = createRoot(host)
  await act(async () => {
    mounted?.render(
      <SkillsFoundCard
        query={query}
        onCount={(total) => counts.push(total)}
        found={() =>
          Promise.resolve('error' in groups ? { ok: false as const, error: groups.error } : { ok: true, value: groups })
        }
        addFound={(path) => {
          added.push(path)
          return Promise.resolve({ ok: true as const, value: ROW })
        }}
      />,
    )
  })
  return { added, counts }
}

const text = () => host?.textContent ?? ''
const buttons = () => [...(host?.querySelectorAll('button') ?? [])]
const rows = () => [...(host?.querySelectorAll('[data-ui="Found skill"]') ?? [])]
const press = async (label: string) => {
  const button = buttons().find(
    (candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent?.includes(label),
  )
  await act(async () => button?.click())
}

describe('Skills found on this machine', () => {
  it('groups the folders under the place each was read from, and says where that folder is', async () => {
    await open()

    expect(text()).toContain('Shared')
    expect(text()).toContain('~/.agents/skills')
    expect(text()).toContain('Claude Code')
  })

  it('names the tools whose own folder links to a skill, on the row it really lives on', async () => {
    await open()
    const row = rows().find((candidate) => candidate.textContent?.includes('ai-sdk'))

    expect(row?.textContent).toContain('Claude Code')
  })

  it('says how many a place really holds when the rest of its entries live elsewhere', async () => {
    await open()

    expect(text()).toContain('1 of its own')
  })

  it('adds one folder on one click, by the folder it is', async () => {
    const { added } = await open()

    await press('Add ai-sdk')

    expect(added).toEqual(['/Users/boss/.agents/skills/ai-sdk'])
  })

  it('marks a row it has just added, so the boss is not offered it twice', async () => {
    await open()

    await press('Add ai-sdk')

    expect(buttons().some((button) => button.getAttribute('aria-label') === 'Add ai-sdk')).toBe(false)
  })

  it('says a folder is already in the Company rather than offering to add it again', async () => {
    await open()

    expect(text()).toContain('Added')
    expect(buttons().some((button) => button.getAttribute('aria-label') === 'Add agent-browser')).toBe(false)
  })

  it('says plainly when the name is taken by another folder, and offers no button', async () => {
    await open()

    expect(text()).toContain('This Company already has a skill named review-checklist')
    expect(buttons().some((button) => button.getAttribute('aria-label') === 'Add review-checklist')).toBe(false)
  })

  it('shows three of a long group and the way to the rest of it', async () => {
    await open()

    expect(text()).toContain('Show all 5')
    expect(rows().filter((row) => row.textContent?.includes('biome'))).toHaveLength(0)

    await press('Show all 5')

    expect(rows().filter((row) => row.textContent?.includes('biome'))).toHaveLength(1)
  })

  it('opens the plugins group shut, because it is the long one nobody went looking for', async () => {
    await open()

    expect(text()).toContain('Show plugin skills')
    expect(rows().some((row) => row.textContent?.includes('deploy-runbook'))).toBe(false)

    await press('Show plugin skills')

    expect(rows().some((row) => row.textContent?.includes('deploy-runbook'))).toBe(true)
  })

  it('filters by name and by what a skill says it does, past every fold', async () => {
    await open(GROUPS, 'what deploy-runbook does')

    expect(rows()).toHaveLength(1)
    expect(text()).toContain('deploy-runbook')
    expect(text()).not.toContain('Shared')
  })

  it('tells the tab how many were found, which is the whole scan and not what is left', async () => {
    const { counts } = await open(GROUPS, 'ai-sdk')

    expect(counts.at(-1)).toBe(7)
  })

  it('says so when nowhere on this machine holds a skill folder, rather than an empty card', async () => {
    await open([])

    expect(text()).toContain('Nothing found')
  })

  it('shows the reason when the scan itself failed', async () => {
    await open({ error: 'Could not read that' })

    expect(text()).toContain('Could not read that')
  })
})
