import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Company } from '../../../shared/company'
import type { ProviderAccount } from '../../../shared/usage/provider-accounts'
import { notConnected, type ProviderUsage, type UsageSnapshot } from '../../../shared/usage/provider-usage'
import { EMPTY_SHELL_DATA } from '../shell/nav-model'
import { USAGE_FOOTER, USAGE_SCOPE, USAGE_UNAVAILABLE, usageView } from './usage-model'

vi.hoisted(() => {
  Object.assign(globalThis, { window: { tinyCorp: { usage: {} } } })
})
const { ProviderCard, UsageCard, UsagePopover, UsageRow, popoverPosition } = await import('./UsageButton')
const { Sidebar } = await import('../shell')

const NOW = new Date('2026-09-18T08:40:00Z')
const noop = () => {}

const claude: ProviderUsage = {
  id: 'claude',
  name: 'Claude',
  problem: null,
  reason: null,
  accounts: [],
  windows: [
    { key: 'five_hour', label: '5h', percent: 6, resetsAt: '2026-09-18T12:50:00Z' },
    { key: 'seven_day', label: 'wk', percent: 15, resetsAt: '2026-09-20T22:00:00Z' },
    { key: 'seven_day_opus', label: 'Opus', percent: 6, resetsAt: '2026-09-20T22:00:00Z' },
  ],
}
const codex = notConnected('codex', 'TinyCorp has no usage source for Codex yet')
const opencode = notConnected('opencode', 'TinyCorp has no usage source for OpenCode yet')

const snapshot = (providers: ProviderUsage[]): UsageSnapshot => ({ providers, readAt: NOW.toISOString() })
const view = (providers: ProviderUsage[] = [claude, codex, opencode], accounts: ProviderAccount[] = []) =>
  usageView(snapshot(providers), NOW, accounts)

const card = (providers?: ProviderUsage[], accounts?: ProviderAccount[]) =>
  renderToStaticMarkup(<UsageCard view={view(providers, accounts)} refreshing={false} onRefresh={noop} />)

/**
 * What one part of the card says, by the `data-ui` name it carries. The assertions used to name the
 * class each part was drawn with; the parts are drawn from utilities now (T210f), and a class list
 * is not what any of these tests was ever about.
 */
const parts = (html: string, ui: string) =>
  [...html.matchAll(new RegExp(`data-ui="${ui}"[^>]*>([^<]*)<`, 'g'))].map((match) => match[1])
const part = (html: string, ui: string) => parts(html, ui)[0] ?? null

describe('the Usage button', () => {
  it('draws the gauge, the word Usage, a mini meter with the percentage and a chevron', () => {
    const html = renderToStaticMarkup(<UsageRow view={view()} />)

    expect(html).toContain('data-ui="Usage Button"')
    expect(html).toContain('>Usage<')
    expect(html).toContain('style="width:15%"')
    expect(part(html, 'Usage Value')).toBe('15%')
    expect(html).toContain('lucide-chevron-up')
    expect(html).toContain('aria-label="Usage — 15% used"')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('leaves its meter empty and reads a dash while nothing answered', () => {
    const html = renderToStaticMarkup(<UsageRow view={view([codex, opencode])} />)

    expect(part(html, 'Usage Value')).toBe('—')
    // An unknown percentage leaves the track empty rather than drawing a zero-width bar.
    expect(html).not.toContain('style="width:')
  })

  it('sits at the foot of the Company drawer, above the boss row', () => {
    const company: Company = {
      id: 'c1',
      name: 'Acme Labs',
      key: 'AL',
      boss: { name: 'Grace Holt', initials: 'GH' },
      folder: '/work/acme',
      createdAt: '',
    }
    const html = renderToStaticMarkup(
      <Sidebar
        company={company}
        companies={[company]}
        data={EMPTY_SHELL_DATA}
        route={{ view: 'chat' }}
        onNavigate={noop}
        onSwitch={noop}
        onCreate={noop}
        onOpen={noop}
      />,
    )

    expect(html).toMatch(/data-ui="Usage Button"[\s\S]*data-ui="Drawer Footer"/)
    expect(html).not.toMatch(/data-ui="Drawer Footer"[\s\S]*data-ui="Usage Button"/)
  })
})

describe('the popover', () => {
  it('heads with Usage, the scope and a refresh control', () => {
    const html = card()

    expect(html).toContain('>Usage</p>')
    expect(html).toContain(`>${USAGE_SCOPE}<`)
    expect(html).toContain('aria-label="Refresh"')
  })

  it('has one layout: no Detailed/Compact switch and no per-row chevron', () => {
    const html = card()

    expect(html).not.toContain('Detailed')
    expect(html).not.toContain('Compact')
    expect(html).not.toContain('data-ui="Layout Switch"')
    expect(html).not.toContain('lucide-chevron-right')
    expect(html).not.toContain('aria-pressed')
  })

  it('gives Claude its countdown and all three meters', () => {
    const html = card()

    expect(parts(html, 'Provider Name')).toContain('Claude')
    expect(parts(html, 'Provider Note')).toContain('Resets in 4h 10m')
    expect(parts(html, 'Meter Label')).toEqual(['5h', 'wk', 'Opus'])
    expect(parts(html, 'Meter Value')).toContain('15%')
  })

  it('draws Codex and OpenCode as Not connected with an inert Connect, and no zero meters', () => {
    const html = card()

    for (const id of ['codex', 'opencode']) {
      expect(html).toMatch(new RegExp(`data-provider="${id}" data-kind="not-connected"`))
    }
    expect(html.match(/>Connect</g)).toHaveLength(2)
    expect(html).not.toMatch(/<button[^>]*>Connect</)
    expect(html).not.toContain('>0%<')
  })

  it('closes with the honesty footer and the Providers link', () => {
    const html = card()

    expect(html).toContain(USAGE_FOOTER)
    expect(part(html, 'Providers Link')).toBe('Providers')
    expect(html).toContain('title="Claude, Codex and OpenCode"')
  })
})

describe('when a Provider cannot be read', () => {
  const failed: ProviderUsage = {
    ...claude,
    windows: [],
    problem: 'unavailable',
    reason: 'No Claude Code login found — sign in by running `claude`',
  }

  it('says so with the reason and a retry, instead of drawing a zero', () => {
    const html = card([failed, codex, opencode])

    expect(html).toContain(`>${USAGE_UNAVAILABLE}<`)
    expect(html).toContain('>No Claude Code login found — sign in by running `claude`<')
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/)
    expect(html).not.toContain('style="width:')
  })

  it('carries the reason once, on its own line rather than beside the name', () => {
    const html = card([failed, codex, opencode])

    expect(html.match(/No Claude Code login found/g)).toHaveLength(1)
    expect(part(html, 'Provider Reason')).toContain('No Claude Code login found')
  })

  it('retries through the same read the refresh control runs', () => {
    const calls: string[] = []
    const tree = ProviderCard({
      row: usageView(snapshot([failed]), NOW).rows[0]!,
      onRetry: () => calls.push('retry'),
    })

    findByText(tree, 'Retry').props.onClick?.()

    expect(calls).toEqual(['retry'])
  })
})

describe('the refresh control', () => {
  it('asks the main process again', () => {
    const calls: string[] = []
    const tree = UsageCard({ view: view(), refreshing: false, onRefresh: () => calls.push('refresh') })

    findByLabel(tree, 'Refresh').props.onClick?.()

    expect(calls).toEqual(['refresh'])
  })

  it('spins and takes no second click while a read is in flight', () => {
    const html = renderToStaticMarkup(<UsageCard view={view()} refreshing onRefresh={noop} />)

    expect(html).toMatch(/<button[^>]*data-refreshing="true"[^>]*disabled/)
  })
})

describe('where the popover opens', () => {
  it('sits above the button, its left edge on the button’s', () => {
    expect(popoverPosition({ left: 68, top: 880 }, 944)).toEqual({ left: 68, bottom: 72, width: 360 })
  })

  it('keeps clear of the window’s edges, and centres on the drawer when never measured', () => {
    expect(popoverPosition({ left: 68, top: 980 }, 944)).toMatchObject({ bottom: 8 })
    expect(popoverPosition(null, 944)).toEqual({ left: 26, bottom: 8, width: 360 })
  })

  it('renders as a dialog the boss can name', () => {
    const html = renderToStaticMarkup(
      <UsagePopover view={view()} refreshing={false} onRefresh={noop} anchor={null} onClose={noop} />,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Usage"')
  })
})

interface Node {
  props: { children?: unknown; onClick?(): void; ['aria-label']?: string }
}

function walk(node: unknown, matches: (element: Node) => boolean): Node | null {
  if (Array.isArray(node)) return node.map((child) => walk(child, matches)).find(Boolean) ?? null
  if (!node || typeof node !== 'object' || !('props' in node)) return null
  const element = node as Node
  if (matches(element)) return element
  return walk(element.props.children, matches)
}

/** The element whose own children hold `text` in a rendered tree, found without a DOM. */
function findByText(node: unknown, text: string): Node {
  const found = walk(node, ({ props }) => {
    const { children } = props
    return children === text || (Array.isArray(children) && children.includes(text))
  })
  if (!found) throw new Error(`no element holding ${text}`)
  return found
}

function findByLabel(node: unknown, label: string): Node {
  const found = walk(node, ({ props }) => props['aria-label'] === label)
  if (!found) throw new Error(`no element labelled ${label}`)
  return found
}

/** The boss's two sign-ins of one Provider, as frame `nV8jR` draws them. */
const signIn = (over: Partial<ProviderAccount>): ProviderAccount => ({
  id: 'primary:claude',
  provider: 'claude',
  label: 'Personal',
  plan: 'Max 20×',
  email: null,
  configDir: '/home/boss/.claude',
  isDefault: true,
  primary: true,
  ...over,
})

const PERSONAL = signIn({})
const WORK = signIn({ id: 'work', label: 'Work', plan: 'Team', isDefault: false, primary: false })

describe('a Provider with several sign-ins (frame nV8jR)', () => {
  const several: ProviderUsage = {
    ...claude,
    accounts: [
      { id: PERSONAL.id, windows: claude.windows, problem: null, reason: null },
      {
        id: WORK.id,
        problem: null,
        reason: null,
        windows: [
          { key: 'five_hour', label: '5h', percent: 41, resetsAt: '2026-09-18T09:42:00Z' },
          { key: 'seven_day', label: 'wk', percent: 22, resetsAt: '2026-09-20T22:00:00Z' },
        ],
      },
    ],
  }

  it('says how many where the reset time goes, and draws a row per sign-in with its own meters', () => {
    const html = card([several, codex, opencode], [PERSONAL, WORK])

    expect(part(html, 'Provider Note')).toBe('2 accounts')
    expect(parts(html, 'Account Label')).toEqual(['Personal · Max 20×', 'Work · Team'])
    expect(parts(html, 'Account Note')).toEqual(['Resets in 4h 10m', 'Resets in 1h 2m'])
    expect(parts(html, 'Meter Value')).toEqual(['6%', '15%', '6%', '41%', '22%'])
    // The Default mark sits on the sign-in Employees take, and on no other.
    expect(html.match(/data-ui="Account Default"/g)).toHaveLength(1)
    expect(html).toContain('>Default<')
  })

  it('says a sign-in was not read, and where it looked, rather than drawing it at zero', () => {
    const unread =
      'No Claude Code login found — sign in by running `claude`. Looked in: C:\\Users\\b\\.claude\\.credentials.json'
    const html = card(
      [
        {
          ...several,
          accounts: [several.accounts[0]!, { id: WORK.id, windows: [], problem: 'unavailable', reason: unread }],
        },
        codex,
        opencode,
      ],
      [PERSONAL, WORK],
    )

    expect(parts(html, 'Account Note')).toEqual(['Resets in 4h 10m', 'usage not read'])
    // The row names the folder; the whole sentence, file and all, is its title (T262).
    expect(part(html, 'Account Reason')).toContain('Looked in: C:\\Users\\b\\.claude')
    expect(html).toContain(
      'title="No Claude Code login found — sign in by running `claude`. Looked in: C:\\Users\\b\\.claude\\.credentials.json"',
    )
  })

  it('keeps the card exactly as it was for a Provider with one sign-in', () => {
    expect(card([claude, codex, opencode], [PERSONAL])).toBe(card([claude, codex, opencode]))
  })
})
