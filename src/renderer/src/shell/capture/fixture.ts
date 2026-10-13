// The design's own sidebar fixture (Pen frame rPfPD), as shell data.

import type { Company, CompanyAttention } from '../../../../shared/company'
import type { BoardSnapshot } from '../../../../shared/domain/board'
import { BOSS, type Channel, dmChannelId } from '../../../../shared/domain/chat'
import type { Employee } from '../../../../shared/domain/staff'
import { EMPTY_STACK, type Repo } from '../../../../shared/repos/repo'
import { EMPTY_SHELL_DATA, type ShellData } from '../nav-model'

const DAY = '2026-09-17'
const at = (time: string) => `${DAY}T${time}:00`

/** The frame's characters, on the faces the design's own markup gives them. */
function person(id: string, name: string, title: string, sprite: number): Employee {
  return {
    id,
    name,
    roleId: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    persona: '',
    capabilities: ['plan', 'code', 'review'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    overrides: [],
    provider: 'claude',
    permissionMode: 'interactive',
    model: null,
    desk: 0,
    sprite,
    createdAt: at('08:00'),
  }
}

const atlas = person('atlas', 'Atlas', 'Backend', 0)
const nova = person('nova', 'Nova', 'Tech Lead', 2)
const orion = person('orion', 'Orion', 'Designer', 3)
const iris = person('iris', 'Iris', 'QA', 4)
const vega = person('vega', 'Vega', 'Frontend', 5)
// Hire order, which is the order the sidebar lists people and names a pair in.
const employees = [nova, vega, iris, atlas, orion]

export const company: Company = {
  id: 'c-tiny',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM' },
  folder: '/work/tiny-corp',
  createdAt: at('08:00'),
}

const channels: Channel[] = ['general', 'tech', 'prs', 'ep-usage-invoices'].map((name) => ({
  id: name,
  kind: 'channel',
  name,
  members: [],
  topic: '',
}))

const board: BoardSnapshot = {
  columns: [],
  targets: [],
  epics: [],
  // The frame counts 31 tickets on Board; only the count is drawn.
  tickets: Array.from({ length: 31 }, (_, i) => ({ id: i + 1 }) as BoardSnapshot['tickets'][number]),
}

const repos: Repo[] = ['web-app', 'api', 'infra'].map((name, i) => ({
  id: `r${i}`,
  name,
  path: `/work/${name}`,
  brief: '',
  rung: 'merge',
  stack: EMPTY_STACK,
  addedAt: at('08:00'),
}))

/*
 * What waits on the boss, as frame `JRSDX` draws it: two rows in `#general`, one in `#tech` and one
 * in the DM with Vega, which is four — the number the Inbox row and the Company rail both say.
 * `#prs` has messages the boss has not read but nothing addressed to them: bold, no pill (T251).
 */
const needsYou = { general: 2, tech: 1, [dmChannelId(BOSS, vega.id)]: 1 }

export const data: ShellData = {
  ...EMPTY_SHELL_DATA,
  employees,
  channels,
  unread: { prs: 3, general: 2, tech: 1, [dmChannelId(BOSS, vega.id)]: 1 },
  needsYou,
  bossInboxUnread: Object.values(needsYou).reduce((a, b) => a + b, 0),
  board,
  repos,
}

/** The same sidebar with a message left unsent in `#tech` and in the DM with the first Employee (TI-1). */
export const drafted: ShellData = {
  ...data,
  drafted: ['tech', dmChannelId(BOSS, employees[0]!.id)],
}

/**
 * The rail of frame `u9sLao`: the Company you are in with two waiting and a Session busy, one with
 * twelve waiting, one only working, and one saying nothing at all. Its own Companies, because the
 * frame's four tiles are what the marks are measured against.
 *
 * The frame prints the second badge as `12` and the rail prints `9+`, because a count past nine
 * would outgrow a 40px tile (T145). Both are two characters, so the pill is the width the frame
 * measures; only the glyphs differ.
 */
export const railCompanies: Company[] = [
  company,
  { ...company, id: 'c-atlas', name: 'Atlas Studio', key: 'AS', folder: '/work/atlas-studio' },
  { ...company, id: 'c-lumen', name: 'Lumen Retail', key: 'LR', folder: '/work/lumen-retail' },
  { ...company, id: 'c-north', name: 'North Vane', key: 'NV', folder: '/work/north-vane' },
]

export const railAttention = new Map<string, CompanyAttention>([
  [company.id, { companyId: company.id, waiting: 2, working: true }],
  ['c-atlas', { companyId: 'c-atlas', waiting: 12, working: false }],
  ['c-lumen', { companyId: 'c-lumen', waiting: 0, working: true }],
])

/** The rail's own height in the frame: four slots, the mark, the divider and the + under them. */
export const RAIL_HEIGHT = 356
