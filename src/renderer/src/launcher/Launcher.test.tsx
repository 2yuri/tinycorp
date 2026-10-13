import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CompanySummary } from '../../../shared/company'
import { isTemporaryFolder, TEMPORARY_ROOTS } from '../../../shared/platform/temporary-folder'
import { CreateCompanyView, type CreateCompanyViewProps, EMPTY_DRAFT } from './CreateCompanyView'
import { LauncherView, type LauncherViewProps } from './Launcher'

const now = new Date('2026-09-17T12:00:00Z')
const acme: CompanySummary = {
  id: 'a',
  name: 'Acme Works',
  key: 'AW',
  boss: { name: 'Ada', initials: 'AD' },
  folder: '/Users/ada/code/acme',
  createdAt: '2026-01-01T00:00:00.000Z',
  open: true,
  current: true,
  employees: 4,
  sessions: 2,
  lastOpenedAt: '2026-09-17T11:00:00.000Z',
  onboardingCompletedAt: '2026-01-01T00:10:00.000Z',
  missing: false,
  databaseElsewhere: false,
}
const globex: CompanySummary = {
  ...acme,
  id: 'g',
  name: 'Globex',
  key: 'GL',
  folder: '/srv/globex',
  open: false,
  current: false,
  employees: 1,
  sessions: 0,
  lastOpenedAt: '2026-09-16T10:00:00.000Z',
}

const noop = () => {}
function launcher(patch: Partial<LauncherViewProps> = {}) {
  return renderToStaticMarkup(
    <LauncherView
      summaries={[acme, globex]}
      now={now}
      highlight={0}
      version="0.9.4"
      error={null}
      onHighlight={noop}
      onOpen={noop}
      onCreate={noop}
      onOpenFolder={noop}
      {...patch}
    />,
  )
}
function create(patch: Partial<CreateCompanyViewProps> = {}) {
  return renderToStaticMarkup(
    <CreateCompanyView
      draft={EMPTY_DRAFT}
      busy={false}
      error={null}
      onDraft={noop}
      onBrowseFolder={noop}
      onBrowseRepo={noop}
      onRepoInitialised={noop}
      onBack={noop}
      onCancel={noop}
      onCreate={noop}
      {...patch}
    />,
  )
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('Launcher', () => {
  it('shows the title, the most recent Company as the wordmark and the tagline', () => {
    const html = launcher()

    expect(html).toMatch(/<span[^>]*>tinycorp<\/span>/)
    expect(html).toMatch(/<svg[^>]*width="78" height="78"/)
    expect(text(html)).toContain('Acme Works Open a company to put its office back to work.')
  })

  it('lists the known Companies with a count, avatar, name, path and meta', () => {
    const shown = text(launcher())

    expect(shown).toContain('YOUR COMPANIES 2')
    expect(shown).toContain('AW Acme Works ~/code/acme 4 employees · 2 sessions · now')
    expect(shown).toContain('GL Globex /srv/globex 1 employee · idle · yesterday')
    expect(launcher()).toMatch(/data-tone="(info|warning|success|error)"/)
  })

  it('badges a row whose setup wizard was never finished, and only that row (T59)', () => {
    const unfinished: CompanySummary = { ...globex, onboardingCompletedAt: null }

    const html = launcher({ summaries: [acme, unfinished] })

    expect(text(html)).toContain('GL Globex Setup unfinished /srv/globex')
    expect(text(html)).not.toMatch(/Acme Works Setup unfinished/)
    expect(html.match(/data-variant="warning"/g)).toHaveLength(1)
    expect(text(launcher())).not.toContain('Setup unfinished')
  })

  it('never badges a row whose folder is gone: it says what is wrong, not what it owes', () => {
    const gone: CompanySummary = { ...globex, onboardingCompletedAt: null, missing: true, employees: null }

    expect(text(launcher({ summaries: [gone] }))).toContain('GL Globex /srv/globex Folder missing')
    expect(text(launcher({ summaries: [gone] }))).not.toContain('Setup unfinished')
  })

  it('marks the highlighted row with ↵ Open and the others with a chevron', () => {
    const first = launcher({ highlight: 0 })
    const second = launcher({ highlight: 1 })

    expect(first.match(/data-highlighted/g)).toHaveLength(1)
    expect(text(first)).toMatch(/~\/code\/acme .* ↵ Open .*Globex/)
    expect(text(second)).toMatch(/Globex .* ↵ Open/)
    expect(first.match(/lucide-chevron-right/g)).toHaveLength(1)
    expect(first).toContain('aria-keyshortcuts="Meta+1"')
  })

  it('caps the list at four rows, and past four Companies puts a search over it that filters them (T267)', () => {
    const names = [
      'Orbit Bank',
      'Kestrel Labs',
      'Pinecone Mobile',
      'Halyard',
      'Northvane',
      'Atlas Studio',
      'Lumen Retail',
    ]
    const many = names.map(
      (name, k): CompanySummary => ({
        ...globex,
        id: `c${k}`,
        name,
        key: `K${k}`,
        folder: `/Users/ada/code/c${k}`,
      }),
    )
    const search = (query: string) => launcher({ summaries: many, query, onQuery: noop })

    // four Companies or fewer: no search, and the capped list is what the frame always drew
    expect(launcher()).not.toContain('data-launcher-search')
    expect(launcher()).toContain('max-h-270')
    expect(launcher({ summaries: many })).not.toContain('data-launcher-search')
    // past four, the search sits under the head and the list keeps its four-row height
    expect(search('')).toContain('data-launcher-search')
    expect(search('')).toMatch(/placeholder="Search companies"/)
    expect(search('')).toContain('h-270')
    expect(text(search(''))).toContain('YOUR COMPANIES 7')
    expect(text(search(''))).toContain('Lumen Retail')
    // the rows are what it matches, and the count stays the whole list
    // the wordmark still names the most recent Company; the list starts at its head
    const ne = text(search('ne')).split('YOUR COMPANIES')[1]!
    expect(ne).toContain('Pinecone Mobile')
    expect(ne).toContain('Northvane')
    expect(ne).not.toContain('Orbit Bank')
    expect(ne.startsWith(' 7 ')).toBe(true)
    expect(text(search('zq'))).toContain('No company matches “zq”.')
    expect(search('zq')).not.toContain('data-highlighted')
  })

  it('offers create and open, and shows the version and the shortcut hint in the footer', () => {
    const shown = text(launcher())

    expect(shown).toContain('Create a company Open an existing folder…')
    expect(shown).toContain('v0.9.4 · beta ⌘ 1–4 opens a company')
    expect(text(launcher({ error: 'No Company in /x' }))).toContain('No Company in /x ⌘')
  })

  it('offers each row’s actions behind a … button when the Launcher can remove Companies', () => {
    const html = launcher({ onMenu: noop })

    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2)
    expect(html).toMatch(/aria-label="Acme Works actions"[^>]*aria-haspopup="menu"/)
    expect(html).toContain('aria-label="Globex actions"')
    expect(launcher()).not.toContain('aria-haspopup="menu"')
  })

  it('warns under the row of a Company in a temporary folder, with Move…', () => {
    const tmp: CompanySummary = { ...globex, folder: '/private/tmp/globex' }
    const moved: string[] = []
    const move = {
      isTemporary: (company: { folder: string }) => isTemporaryFolder(company.folder, TEMPORARY_ROOTS),
      moving: null,
      error: null,
      move: (company: { id: string }) => void moved.push(company.id),
    }

    const html = launcher({ summaries: [acme, tmp], move })

    expect(html.match(/data-variant="warning"/g)).toHaveLength(1)
    expect(text(html)).toMatch(
      /Globex \/private\/tmp\/globex .* This company lives in a temporary folder and can be lost on restart Move… Create a company/,
    )
    expect(text(html)).not.toMatch(/Acme Works .* temporary folder .* Globex/)
    expect(html).toMatch(/<button[^>]*>.*Move…<\/span><\/button>/)
    expect(launcher({ summaries: [acme, tmp] })).not.toContain('temporary folder')
  })

  it('shows a move in progress and a failed move on that row only', () => {
    const tmp: CompanySummary = { ...globex, folder: '/tmp/globex' }
    const base = { isTemporary: () => true, moving: null, error: null, move: noop }

    const busy = launcher({ summaries: [tmp], move: { ...base, moving: tmp.id } })
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>.*Moving…<\/span><\/button>/)

    const failed = launcher({
      summaries: [acme, tmp],
      move: { ...base, error: { companyId: tmp.id, message: 'Disk full' } },
    })
    expect(failed.match(/Disk full/g)).toHaveLength(1)
    expect(text(failed)).toMatch(/Globex .* Disk full Move…/)
  })

  it('shows a Company whose folder is gone as unavailable: muted, Folder missing and no Open', () => {
    const gone: CompanySummary = { ...globex, missing: true, employees: null, lastOpenedAt: null }

    const html = launcher({ summaries: [gone], highlight: 0, onForget: noop })

    expect(text(html)).toContain('GL Globex /srv/globex Folder missing')
    // Unavailable is the row being disabled, and muted is the only opacity on the screen.
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(html).toContain('opacity-55')
    expect(text(html)).not.toContain('↵ Open')
    expect(html).not.toContain('lucide-chevron-right')
  })

  /**
   * A Company folder in WSL keeps its database on this PC, so the folder can be right there and
   * the Company still have nothing to open — another PC's AppData holds it (T256). The row is
   * unavailable for the same reason a gone folder makes one, and Forget is all it offers.
   */
  it('shows a Company whose database this PC does not hold as unavailable, with Forget', () => {
    const elsewhere: CompanySummary = { ...globex, databaseElsewhere: true, employees: null }

    const html = launcher({ summaries: [elsewhere], highlight: 0, onMenu: noop, onForget: noop })

    expect(text(html)).toContain('GL Globex /srv/globex Database on another PC')
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(html).toMatch(/title="Remove Globex from the launcher"/)
    expect(html).not.toContain('aria-label="Globex actions"')
  })

  it('offers Forget on a missing row, and the … menu on the rows that have a folder', () => {
    const gone: CompanySummary = { ...globex, missing: true }
    const forgotten: string[] = []

    const html = launcher({
      summaries: [acme, gone],
      onMenu: noop,
      onForget: (summary) => void forgotten.push(summary.id),
    })

    expect(html).toMatch(/title="Remove Globex from the launcher"[^>]*>.*Forget<\/span><\/button>/)
    expect(html.match(/from the launcher/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Acme Works actions"')
    expect(html).not.toContain('aria-label="Globex actions"')
    expect(launcher({ summaries: [gone], onMenu: noop })).not.toContain('from the launcher')
  })

  it('names the app when there is no Company yet', () => {
    const html = launcher({ summaries: [] })

    expect(text(html)).toContain('tinycorp Create a company to put an office to work.')
    expect(html).not.toContain('YOUR COMPANIES')
  })
})

describe('Launcher / Create Company', () => {
  it('shows the head, the fields and the footer the design names', () => {
    const shown = text(create())

    expect(shown).toContain('Create a company Point it at a folder. The staff, the board and the chat live inside it.')
    expect(shown).toMatch(/COMPANY NAME.*FOLDER.*FIRST REPOSITORY.*AUTONOMY/)
    expect(shown).toContain('Concurrency cap Extra Employees wait for a desk')
    expect(shown).toContain('Notifications Approvals, mentions, PRs, budget')
    expect(shown).toContain('You can change all of this later in Company settings. Cancel Create company')
    expect(create()).toMatch(/aria-label="Back"/)
  })

  it('offers three autonomy cards with Managed selected, the default cap and notifications on', () => {
    const html = create()

    expect(text(html)).toContain(
      'Supervised Asks before every step Managed Asks for merges and hires Autonomous Reports when work is done',
    )
    expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1)
    // The selected card is the one whose radio is checked, and its name is the next thing in it.
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*>.*?>Managed</)
    expect(html).toMatch(/<output[^>]*>5<\/output>/)
    expect(html).toMatch(/role="switch"[^>]*checked=""/)
  })

  it('shows the detected checks of the first repository, a brief and the collapsed optional Checks', () => {
    const html = create({
      draft: {
        ...EMPTY_DRAFT,
        folder: '/Users/ada/code/acme',
        repo: {
          path: '/Users/ada/code/acme/web',
          gitRepo: true,
          stack: { language: 'TypeScript', framework: 'React', packageManager: 'pnpm' },
          commands: ['pnpm install', 'pnpm build'],
        },
      },
    })

    expect(text(html)).toContain('~/code/acme ')
    expect(text(html)).toContain('~/code/acme/web')
    expect(text(html)).toContain('Checks detected pnpm install pnpm build')
    expect(text(html)).toContain('About this repo')
    expect(html).toContain('placeholder="What is this repo? Any stack preferences, or let the team decide."')
    expect(html).toMatch(/aria-expanded="false"[^>]*>.*?Checks.*?Optional/)
    expect(html).not.toContain('INSTALL')
  })

  it('shows the folder it will use before the boss has picked one, and follows the name (T252)', () => {
    const html = create({
      draft: { ...EMPTY_DRAFT, name: 'Acme' },
      hints: { home: '/Users/ada', syncedRoots: [] },
    })

    expect(text(html)).toContain('~/TinyCorp/Acme')
    expect(html).not.toContain('Choose a folder…')
    // Nothing is suggested until the main process has answered, and then the field is a placeholder.
    expect(create({ draft: { ...EMPTY_DRAFT, name: 'Acme' } })).toContain('Choose a folder…')
  })

  it('refuses a network share on the spot and keeps Create disabled until another folder (T252)', () => {
    const share = { ...EMPTY_DRAFT, name: 'Acme', folder: '\\\\nas\\share\\acme' }

    const html = create({ draft: share, hints: { home: 'C:\\Users\\boss', syncedRoots: [] } })

    expect(text(html)).toContain('A Company folder has to be on a drive of this PC')
    expect(text(html)).toContain('Pick a folder on C: or another drive')
    expect(html).toMatch(/role="alert">A Company folder/)
    expect(html).toMatch(/type="submit"[^>]*disabled=""/)
    // A folder on a drive leaves Create pressable.
    expect(create({ draft: { ...share, folder: 'C:\\work\\acme' } })).not.toMatch(/type="submit"[^>]*disabled=""/)
  })

  /** Frame `iNGDQ`: the folder is accepted, and the line under the field says where the database goes. */
  it('accepts a folder in WSL and says its database stays on this PC (T256)', () => {
    const html = create({
      draft: { ...EMPTY_DRAFT, name: 'Acme' },
      hints: { home: '\\\\wsl.localhost\\archlinux\\home\\boss', syncedRoots: [] },
    })

    expect(text(html)).toContain('\\\\wsl.localhost\\archlinux\\home\\boss\\TinyCorp\\Acme')
    expect(text(html)).toContain('Lives in WSL. Its database stays on this PC, in AppData')
    expect(html).not.toMatch(/type="submit"[^>]*disabled=""/)
    expect(text(html)).toContain('You can change all of this later')
  })

  it('warns under the folder field about a folder OneDrive syncs, without refusing it (T252)', () => {
    const html = create({
      draft: { ...EMPTY_DRAFT, name: 'Acme', folder: 'C:\\Users\\boss\\OneDrive\\Documents\\Acme' },
      hints: { home: 'C:\\Users\\boss', syncedRoots: ['C:\\Users\\boss\\OneDrive'] },
    })

    expect(text(html)).toContain('This folder is synced by OneDrive')
    expect(text(html)).toContain('A folder outside OneDrive is safer.')
    // It is a warning: Create still works, and the footer keeps its own line.
    expect(html).not.toMatch(/type="submit"[^>]*disabled=""/)
    expect(text(html)).toContain('You can change all of this later')
    // A folder outside it says nothing.
    expect(
      text(
        create({
          draft: { ...EMPTY_DRAFT, name: 'Acme', folder: 'C:\\work\\Acme' },
          hints: { home: 'C:\\Users\\boss', syncedRoots: ['C:\\Users\\boss\\OneDrive'] },
        }),
      ),
    ).not.toContain('synced by OneDrive')
  })

  it('offers to initialise a repository that is not a git repo, and shows errors in the footer', () => {
    const html = create({
      draft: { ...EMPTY_DRAFT, repo: { path: '/tmp/x', gitRepo: false, stack: null, commands: [] } },
      error: 'Give the Company a name',
    })

    expect(text(html)).toContain('Not a git repository yet')
    expect(html).not.toContain('About this repo')
    expect(html).toMatch(/data-ui="Button"[^>]*>.*Initialise repository/)
    expect(html).toMatch(/role="alert">Give the Company a name/)
    expect(text(html)).not.toContain('You can change all of this later')
  })
})
