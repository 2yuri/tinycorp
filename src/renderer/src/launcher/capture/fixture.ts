import type { CompanySummary } from '../../../../shared/company'

const BOSS = { name: 'Ada Lorne', initials: 'AL' }

/**
 * The Launcher's list as the frame draws it, plus the row T59 adds: a Company created but never
 * taken through the setup wizard. Nothing here touches the engine.
 */
export const SUMMARIES: CompanySummary[] = [
  {
    id: 'tiny',
    name: 'Tiny Corp',
    key: 'TC',
    boss: BOSS,
    folder: '/Users/ada/code/tinycorp',
    createdAt: '2026-06-01T09:00:00.000Z',
    open: true,
    current: true,
    employees: 8,
    sessions: 5,
    lastOpenedAt: '2026-09-22T11:59:30.000Z',
    onboardingCompletedAt: '2026-06-01T09:14:00.000Z',
    missing: false,
    databaseElsewhere: false,
  },
  {
    id: 'lumen',
    name: 'Lumen Labs',
    key: 'LL',
    boss: BOSS,
    folder: '/Users/ada/code/lumen',
    createdAt: '2026-09-22T11:40:00.000Z',
    open: false,
    current: false,
    employees: 0,
    sessions: 0,
    lastOpenedAt: '2026-09-22T11:42:00.000Z',
    onboardingCompletedAt: null,
    missing: false,
    databaseElsewhere: false,
  },
  {
    id: 'globex',
    name: 'Globex',
    key: 'GX',
    boss: BOSS,
    folder: '/Users/ada/work/globex',
    createdAt: '2026-03-12T09:00:00.000Z',
    open: false,
    current: false,
    employees: 3,
    sessions: 0,
    lastOpenedAt: '2026-09-21T16:00:00.000Z',
    onboardingCompletedAt: '2026-03-12T09:21:00.000Z',
    missing: false,
    databaseElsewhere: false,
  },
]

/**
 * A boss with a dozen Companies (T267, frames `yIGme`, `sM1IQ`, `grF2I`): the three above, then
 * nine more, each opened a little longer ago than the one before it.
 */
export const MANY: CompanySummary[] = [
  ...SUMMARIES,
  ...(
    [
      ['atlas', 'Atlas Studio', 'AS', '/Users/ada/work/atlas-studio', 4],
      ['retail', 'Lumen Retail', 'LR', '/Users/ada/code/lumen-retail', 6],
      ['northvane', 'Northvane', 'NV', '/Users/ada/code/northvane', 2],
      ['orbit', 'Orbit Bank', 'OB', '/Users/ada/work/orbit-bank', 6],
      ['kestrel', 'Kestrel Labs', 'KL', '/Users/ada/code/kestrel', 2],
      ['pinecone', 'Pinecone Mobile', 'PM', '/Users/ada/code/pinecone', 5],
      ['halyard', 'Halyard', 'HY', '/Users/ada/work/halyard', 1],
      ['sable', 'Sable Robotics', 'SR', '/Users/ada/code/sable', 3],
      ['marlow', 'Marlow Health', 'MH', '/Users/ada/work/marlow', 4],
    ] as const
  ).map(
    ([id, name, key, folder, employees], k): CompanySummary => ({
      id,
      name,
      key,
      boss: BOSS,
      folder,
      createdAt: '2026-02-01T09:00:00.000Z',
      open: false,
      current: false,
      employees,
      sessions: 0,
      lastOpenedAt: new Date(Date.parse('2026-09-20T12:00:00.000Z') - k * 3 * 86_400_000).toISOString(),
      onboardingCompletedAt: '2026-02-01T09:20:00.000Z',
      missing: false,
      databaseElsewhere: false,
    }),
  ),
]

/** The clock the row meta is written against, so the capture reads the same every time. */
export const NOW = new Date('2026-09-22T12:00:00.000Z')
