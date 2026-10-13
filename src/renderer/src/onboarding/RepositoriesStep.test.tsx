import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import type { FoundRepo } from '../../../shared/repos/found-repos'
import { knownFoundRepos } from '../repositories'
import { RepositoriesStepView, type RepositoriesStepViewProps } from './RepositoriesStep'
import type { ConnectedCard } from './repositories-step-model'
import { SetupWizardView } from './SetupWizard'

const noop = () => {}

const webApp: ConnectedCard = {
  id: 'r1',
  name: 'web-app',
  branch: 'main',
  pathLine: '~/code/tinycorp/web-app · added when you created the company',
  brief: 'Customer-facing web app. React with Vite; keep components in src/ui.',
  checksDetected: true,
  commands: [
    { key: 'install', command: 'pnpm install' },
    { key: 'build', command: 'pnpm build' },
    { key: 'test', command: 'vitest run' },
    { key: 'lint', command: 'biome check' },
  ],
  roles: ['Tech Lead', 'Frontend', 'Backend'],
}

const FOLDER = '/Users/ada/code/tinycorp'

const FOUND: FoundRepo[] = [
  { path: `${FOLDER}/billing-api`, relative: 'billing-api', kind: 'repo', parent: null },
  { path: `${FOLDER}/infra`, relative: 'infra', kind: 'repo', parent: null },
]

function step(patch: Partial<RepositoriesStepViewProps> = {}) {
  return renderToStaticMarkup(
    <RepositoriesStepView
      cards={[webApp]}
      found={knownFoundRepos(FOLDER, FOUND, [])}
      counts={{ connected: 1, described: 1, selected: 0, found: 2 }}
      connectedLabel="Connected (web-app)"
      access={null}
      error={null}
      onAddAnywhere={noop}
      onStartHere={noop}
      onEditRepo={noop}
      onBrief={noop}
      onDisconnect={noop}
      onChangeAccess={noop}
      onToggleRole={noop}
      onDoneAccess={noop}
      {...patch}
    />,
  )
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('Repositories step view', () => {
  it.each([
    ['darwin', 'this Mac'],
    ['win32', 'this PC'],
    ['linux', 'this computer'],
  ])('on %s, adds a repository from anywhere on %s (T265)', (platform, machine) => {
    const holder = globalThis as { window?: unknown }
    holder.window = { tinyCorp: { shell: { platform } } }
    try {
      expect(text(step())).toContain(`Add a repository from anywhere on ${machine}`)
    } finally {
      delete holder.window
    }
  })

  it('shows the connected repo with branch, path, brief, detected checks and who can work here', () => {
    const html = step()
    const shown = text(html)

    expect(shown).toContain(
      'CONNECTED web-app main ~/code/tinycorp/web-app · added when you created the company Checks detected',
    )
    expect(shown).toContain('About this repo')
    expect(html).toContain('>Customer-facing web app. React with Vite; keep components in src/ui.</textarea>')
    expect(html).toContain('placeholder="What is this repo? Any stack preferences, or let the team decide."')
    expect(shown).toContain('install pnpm install build pnpm build test vitest run lint biome check')
    expect(shown).toContain('Who can work here Tech Lead Frontend Backend Change')
  })

  it('offers the repos found beside it as a tree to tick, then Add a repository from anywhere', () => {
    const shown = text(step())

    expect(shown).toContain(
      'FOUND IN ~/code/tinycorp · 2 REPOSITORIES / Select all None 0 selected of 2 new TOP LEVEL · 2 billing-api billing-api/ infra infra/ Add a repository from anywhere on this Mac',
    )
  })

  it('shows the rules and the counts, and warns only when nothing is connected', () => {
    const shown = text(step())
    expect(shown).toContain('How repos are used The rules every employee works under.')
    expect(shown).toContain(
      'Each ticket gets its own worktree outside the repo folder — your working tree is never touched.',
    )
    expect(shown).toContain('Checks run before every PR once they exist. A new repo can start without them.')
    expect(shown).toContain('Nobody can read or write outside the repos you connect here.')
    expect(shown).toContain('Connected (web-app) 1 Described 1 Selected to connect 0 Found, not selected 2')
    expect(shown).not.toContain('Connect at least one repo')

    const empty = text(
      step({ cards: [], counts: { connected: 0, described: 0, selected: 0, found: 2 }, connectedLabel: 'Connected' }),
    )
    expect(empty).not.toContain('CONNECTED')
    expect(empty).toContain('Connected 0 Described 0 Selected to connect 0 Found, not selected 2')
    expect(empty).toContain('Connect at least one repo, or the team has nowhere to work.')

    const ticked = text(step({ counts: { connected: 1, described: 1, selected: 23, found: 86 } }))
    expect(ticked).toContain('Nothing is added until you continue.')
    expect(ticked).not.toContain('Connect at least one repo')
  })

  it('shows the soft No checks yet for a repo without checks and an empty brief', () => {
    const html = step({ cards: [{ ...webApp, brief: '', checksDetected: false, commands: [], roles: [] }] })

    expect(text(html)).toContain('No checks yet')
    expect(text(html)).not.toContain('Stack required')
    expect(text(html)).not.toContain('Checks detected')
    expect(html).toContain('></textarea>')
    expect(text(html)).toContain('Who can work here Nobody yet Change')
  })

  it('offers every working role as a toggle while Change is open', () => {
    const shown = step({
      access: {
        repoId: 'r1',
        roles: [
          { id: 'lead', name: 'Tech Lead', allowed: true },
          { id: 'qa', name: 'QA', allowed: false },
        ],
      },
    })

    expect(shown).toMatch(/aria-pressed="true"[^>]*>Tech Lead</)
    expect(shown).toMatch(/aria-pressed="false"[^>]*>QA</)
    expect(text(shown)).toContain('QA Done')
  })

  it('offers to start a repository when the folder holds none, and shows a problem', () => {
    const shown = text(step({ found: knownFoundRepos(FOLDER, [], []), error: '/x is not a git repo' }))

    expect(shown).toContain('No repositories inside this folder — start one here?')
    expect(shown).toContain('/x is not a git repo')
    expect(shown).toContain('Add a repository from anywhere on this Mac')
  })
})

describe('Repositories step with a folder that is not a repo yet', () => {
  it('offers to initialise the folder picked from anywhere', () => {
    const html = step({ uninitialised: '/Users/ada/notes' })

    expect(html).toContain('data-ui="Alert"')
    expect(text(html)).toContain('Not a git repository yet')
    expect(html).toMatch(/data-ui="Button"[^>]*>.*Initialise repository/)
    expect(text(step())).not.toContain('Not a git repository yet')
  })
})

describe('Setup wizard on the Repositories step', () => {
  const company: Company = {
    id: 't',
    name: 'Tiny Corp',
    key: 'TC',
    boss: { name: 'Ada', initials: 'AD' },
    folder: '/Users/ada/code/tinycorp',
    createdAt: '2026-09-17T00:00:00.000Z',
  }

  it('shows step 4 with its head and holds Continue until a repo is connected', () => {
    const view = (continueDisabled: boolean) =>
      renderToStaticMarkup(
        <SetupWizardView
          company={company}
          state={{ step: 'repositories', preset: 'product-squad', roster: [], goal: '' }}
          autonomy="managed"
          provider="claude"
          onPreset={noop}
          onBack={noop}
          onContinue={noop}
          onSkip={noop}
          continueDisabled={continueDisabled}
        />,
      )

    expect(text(view(true))).toContain(
      'STEP 4 OF 5 Which repositories can they touch? Employees only work inside repos you connect. Tell them what each one is; checks are optional and detected when possible.',
    )
    expect(view(true)).toMatch(/data-action="continue" disabled=""/)
    expect(view(false)).not.toMatch(/data-action="continue" disabled/)
    expect(text(view(true))).toContain('Skip setup')
  })
})
