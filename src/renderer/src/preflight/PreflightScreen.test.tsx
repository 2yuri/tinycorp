import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Boss } from '../../../shared/boss-profile'
import type { Provider } from '../../../shared/domain/providers'
import { PROVIDER_LABEL, PROVIDERS } from '../../../shared/domain/providers'
import {
  blockedProviders,
  PREFLIGHT_STILL_OPENS,
  type PreflightState,
  type ProviderPreflight,
} from '../../../shared/providers/preflight'
import { PreflightCard } from './PreflightCard'
import { CHOOSER_SUB, CHOOSER_TITLE, firstOpenProvider } from './PreflightChooser'
import {
  PREFLIGHT_CHOOSER_TAGLINE,
  PreflightScreen,
  preflightIsChooser,
  preflightTagline,
  preflightTakesTheWindow,
} from './PreflightScreen'

const noop = () => {}

/**
 * One Provider's answer, written the way that Provider's own adapter writes it. The renderer is
 * handed words, never a product, so these are the words and nothing here is derived from them.
 */
function check(provider: Provider, state: PreflightState, over: Partial<ProviderPreflight> = {}): ProviderPreflight {
  const signedIn = { account: 'boss@example.com', plan: 'Max' }
  const signedOut = { account: null, plan: null }
  const claude = {
    missing: {
      title: 'Claude Code is not installed',
      body: 'TinyCorp could not find the claude command on this Mac — so no Employee on Claude Code can start.',
      lead: 'Install it once, in a terminal, and every Company here works:',
      commands: ['npm install -g @anthropic-ai/claude-code', 'claude /login'],
      note: PREFLIGHT_STILL_OPENS,
      ...signedOut,
    },
    'signed-out': {
      title: 'Claude Code is not signed in',
      body: 'TinyCorp found the command, but no subscription login — so no Employee on Claude Code can start.',
      lead: 'Sign in once, in a terminal, and every Company here works:',
      commands: ['claude /login', 'claude auth status'],
      note: PREFLIGHT_STILL_OPENS,
      ...signedOut,
    },
    warning: {
      title: 'Claude Code is using an API key',
      body: 'ANTHROPIC_API_KEY is set around TinyCorp. Everything still runs.',
      lead: 'Clear it where you start TinyCorp:',
      commands: ['unset ANTHROPIC_API_KEY', 'claude auth status'],
      note: 'Everything still runs — this is here so the bill is never a surprise.',
      ...signedIn,
    },
    ready: {
      title: 'Claude Code is signed in',
      body: 'Every Employee on Claude Code runs as a session on your own subscription.',
      lead: '',
      commands: [],
      note: 'Nothing to do.',
      ...signedIn,
    },
  }
  const codex = {
    ...claude[state],
    title: claude[state].title.replace('Claude Code', 'Codex'),
    body: claude[state].body.replace(/Claude Code/g, 'Codex').replace('claude command', 'codex command'),
    commands: claude[state].commands.map((command) =>
      command
        .replace('@anthropic-ai/claude-code', '@openai/codex')
        .replace(/^claude \/login$/, 'codex login')
        .replace(/^claude auth status$/, 'codex login status'),
    ),
  }
  return {
    provider,
    state,
    checkedAt: '2026-09-21T09:00:00.000Z',
    hired: true,
    ...(provider === 'codex' ? codex : claude[state]),
    ...over,
  }
}

const screen = (blocked: ProviderPreflight[], boss: Boss | null = null) =>
  renderToStaticMarkup(
    <PreflightScreen blocked={blocked} boss={boss} checking={false} onRecheck={noop} onDismiss={noop} />,
  )

const card = (state: PreflightState, patch: { checking?: boolean; dismissable?: boolean } = {}) =>
  renderToStaticMarkup(
    <PreflightCard
      check={check('claude', state)}
      checking={patch.checking ?? false}
      onRecheck={noop}
      onDismiss={patch.dismissable === false ? undefined : noop}
    />,
  )

/** The commands of the mono boxes, in the order the screen draws them. */
function commands(html: string): string[] {
  return [...html.matchAll(/<code[^>]*>([^<]*)</g)].map(([, line]) => line!)
}

/** The card titles on the screen, in order. */
function titles(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]*)</g)].map(([, title]) => title!)
}

/** One card's markup each, in the order the screen draws them. */
function cards(html: string): string[] {
  return html.split('data-ui="Provider Status"').slice(1)
}

/** The chooser's rows, in order: whose, whether it is the open one, and what its badge says. */
function rows(html: string): { provider: string; open: boolean; badge: string }[] {
  return html
    .split('data-ui="Provider Row"')
    .slice(1)
    .map((chunk) => ({
      provider: /data-provider="([^"]*)"/.exec(chunk)?.[1] ?? '',
      open: /aria-expanded="true"/.test(chunk),
      badge: /data-slot="badge-label">([^<]*)</.exec(chunk)?.[1] ?? '',
    }))
}

/** Every Provider's answer with nobody hired on any of them: what the chooser is handed. */
const machine = (states: Partial<Record<Provider, PreflightState>>): ProviderPreflight[] =>
  PROVIDERS.map((provider) => check(provider, states[provider] ?? 'missing', { hired: false }))

describe('The preflight screen (frame KB9AX)', () => {
  it('draws the mark, the wordmark and the tagline over the card', () => {
    const html = screen([check('claude', 'signed-out')])

    expect(html).toContain('data-pencil-name="Desktop App / Provider Missing"')
    expect(html).toContain('>Tiny Corp<')
    expect(html).toContain(preflightTagline())
    expect(html).toContain('Claude Code is not signed in')
  })

  it('shows the two commands of the frame when nobody is signed in', () => {
    expect(commands(screen([check('claude', 'signed-out')]))).toEqual(['claude /login', 'claude auth status'])
  })

  it('leads with the install line when the CLI is not on the PATH', () => {
    const html = screen([check('claude', 'missing')])

    expect(html).toContain('Claude Code is not installed')
    expect(commands(html)[0]).toBe('npm install -g @anthropic-ai/claude-code')
  })

  it('promises the rest of the app still opens, and makes that line the way out', () => {
    const html = screen([check('claude', 'signed-out')])

    expect(html).toContain(PREFLIGHT_STILL_OPENS)
    expect(html).toMatch(/<button[^>]*title="Open TinyCorp anyway"[^>]*>/)
  })

  it('carries a copy button per command', () => {
    const html = screen([check('claude', 'signed-out')])

    expect(html).toContain('aria-label="Copy claude /login"')
    expect(html).toContain('aria-label="Copy claude auth status"')
  })

  it('says it is checking while Check again is out', () => {
    expect(card('signed-out', { checking: true })).toContain('Checking…')
    expect(card('signed-out')).toContain('Check again')
  })

  it('is only a sentence, never a way out, where there is nothing to leave', () => {
    const html = card('signed-out', { dismissable: false })

    expect(html).toContain(PREFLIGHT_STILL_OPENS)
    expect(html).not.toContain('Open TinyCorp anyway')
  })

  it('says all is well when the CLI is signed in', () => {
    const html = card('ready', { dismissable: false })

    expect(html).toContain('Claude Code is signed in')
    // The tick and its green are what `ready` draws; the card says the state it is in.
    expect(html).toContain('data-state="ready"')
    expect(html).toContain('lucide-check')
  })
})

describe('Two Providers in trouble (T135)', () => {
  it('draws one card each, in its own product’s words and commands', () => {
    const html = screen([check('claude', 'signed-out'), check('codex', 'missing')])

    expect(titles(html)).toEqual(['Claude Code is not signed in', 'Codex is not installed'])
    expect(commands(html)).toEqual([
      'claude /login',
      'claude auth status',
      'npm install -g @openai/codex',
      'codex login',
    ])
  })

  it('says an Employee is a coding agent on any Provider, never only the one in trouble', () => {
    const tagline = preflightTagline()
    expect(tagline).toMatch(/^Every Employee is a coding agent on your own subscription: .+ or .+\.$/)
    for (const provider of PROVIDERS) expect(tagline).toContain(PROVIDER_LABEL[provider])
  })

  it('shares one Check again between them: the last card carries it, and only the last', () => {
    const html = screen([check('claude', 'signed-out'), check('codex', 'missing')])

    expect([...html.matchAll(/Check again/g)]).toHaveLength(1)
    expect([...html.matchAll(/title="Open TinyCorp anyway"/g)]).toHaveLength(1)
    // The button belongs to the second card, so nothing sits between the last commands and it.
    expect(html.lastIndexOf('Codex is not installed')).toBeLessThan(html.indexOf('Check again'))
  })

  it('never shows a card or a command for a Provider it is not hired on', () => {
    const html = screen([check('claude', 'signed-out')]).replace(preflightTagline(), '')

    expect(html).not.toContain('Codex')
    expect(html).not.toContain('codex')
  })
})

describe('Whether the cards take the window', () => {
  it('takes it for every state that stops an Employee, and never once dismissed', () => {
    for (const state of ['missing', 'signed-out'] as const) {
      expect(preflightTakesTheWindow([check('claude', state)], false), state).toBe(true)
      expect(preflightTakesTheWindow([check('claude', state)], true), state).toBe(false)
    }
  })

  it('lets a warning through: an API key is not a wall', () => {
    expect(preflightTakesTheWindow([check('claude', 'warning')], false)).toBe(false)
  })

  it('takes it when one Provider an Employee is hired on is broken and another is fine', () => {
    expect(preflightTakesTheWindow([check('claude', 'ready'), check('codex', 'missing')], false)).toBe(true)
  })

  it('lets go the moment Check again comes back good, and never draws before the answers are in', () => {
    expect(preflightTakesTheWindow([check('claude', 'ready')], false)).toBe(false)
    expect(preflightTakesTheWindow(null, false)).toBe(false)
    expect(preflightTakesTheWindow([], false)).toBe(false)
  })
})

/**
 * Before the first Employee nobody is stopped by anything, and Claude, Codex and OpenCode are
 * equals: one of them installed is enough to use TinyCorp (T169). A boss who runs only one product
 * used to open TinyCorp into a card about a product they had never asked for.
 */
describe('Whether the cards take the window before any Company or hire', () => {
  it('blocks nothing when one Provider is ready and the rest are not installed', () => {
    for (const provider of PROVIDERS) {
      expect(preflightTakesTheWindow(machine({ [provider]: 'ready' }), false), provider).toBe(false)
      expect(blockedProviders(machine({ [provider]: 'ready' })), provider).toEqual([])
    }
  })

  it('draws one card per Provider, in catalogue order, when none of them can run an Employee', () => {
    const none = machine(Object.fromEntries(PROVIDERS.map((provider) => [provider, 'missing' as const])))

    expect(preflightTakesTheWindow(none, false)).toBe(true)
    expect(blockedProviders(none).map((entry) => entry.provider)).toEqual([...PROVIDERS])
  })

  it('shows a signed-out Provider’s card only while nothing else is ready', () => {
    const last = PROVIDERS.at(-1)!
    const [first] = PROVIDERS as [Provider, ...Provider[]]

    // Installed but signed out, and nothing else on the Mac: its card, with every other one.
    expect(blockedProviders(machine({ [last]: 'signed-out' })).map((entry) => entry.provider)).toEqual([...PROVIDERS])
    // The same machine with one product ready: nothing to say, and no card.
    expect(blockedProviders(machine({ [first]: 'ready', [last]: 'signed-out' }))).toEqual([])
  })

  it('still blocks on a Provider an Employee is hired on, whatever else is ready', () => {
    // Inside a Company the answers are the hired Providers only, and one of them broken stops the
    // Employees on it — another product being installed is no comfort to them.
    const hired = [check('claude', 'ready'), check('codex', 'signed-out')]

    expect(blockedProviders(hired).map((entry) => entry.provider)).toEqual(['codex'])
  })
})

/**
 * The chooser (T250, frames `KB9AX` and `c8knu`). Before the first hire nobody is stopped by
 * anything and any one of the three is enough, so a machine with none of them installed is one
 * thing to do rather than three errors stacked in a scroller.
 */
describe('The chooser, when no CLI here can run an Employee', () => {
  const none = machine({})

  it('is the chooser only before the first hire; a hired Provider is still a card', () => {
    expect(preflightIsChooser(none)).toBe(true)
    expect(preflightIsChooser([check('claude', 'missing')])).toBe(false)
    expect(preflightIsChooser([])).toBe(false)
  })

  it('draws one card with a row per Provider, in catalogue order', () => {
    const html = screen(none)

    expect(html).toContain(CHOOSER_TITLE)
    expect(html).toContain(CHOOSER_SUB)
    expect(rows(html).map((row) => row.provider)).toEqual([...PROVIDERS])
    expect(cards(html)).toHaveLength(0)
  })

  it('opens exactly one row, and it is the Provider closest to working', () => {
    const signedOut = PROVIDERS.at(-1)!
    const open = rows(screen(machine({ [signedOut]: 'signed-out' }))).filter((row) => row.open)

    // Installed and one `login` away beats the catalogue's first, which is not installed at all.
    expect(open.map((row) => row.provider)).toEqual([signedOut])
  })

  it('falls back to the catalogue’s first when none of them is even installed', () => {
    expect(
      rows(screen(none))
        .filter((row) => row.open)
        .map((row) => row.provider),
    ).toEqual([PROVIDERS[0]])
    expect(firstOpenProvider(none)).toBe(PROVIDERS[0])
  })

  it('says the state in the badge, in the word that state is', () => {
    const signedOut = PROVIDERS.at(-1)!
    const drawn = rows(screen(machine({ [signedOut]: 'signed-out' })))

    expect(drawn.map((row) => row.badge)).toEqual(
      PROVIDERS.map((provider) => (provider === signedOut ? 'Not signed in' : 'Not installed')),
    )
  })

  it('shows the commands of the open row and of no other', () => {
    const signedOut = PROVIDERS.at(-1)!
    const html = screen(machine({ [signedOut]: 'signed-out' }))

    expect(commands(html)).toEqual(check(signedOut, 'signed-out').commands)
  })

  it('drops the list of products from the tagline, because the rows name them', () => {
    const html = screen(none)

    expect(html).toContain(PREFLIGHT_CHOOSER_TAGLINE)
    expect(html).not.toContain(preflightTagline())
  })

  it('shares one Check again and one way out between every row', () => {
    const html = screen(none)

    expect([...html.matchAll(/Check again/g)]).toHaveLength(1)
    expect([...html.matchAll(/title="Open TinyCorp anyway"/g)]).toHaveLength(1)
    expect(html).toContain(PREFLIGHT_STILL_OPENS)
  })
})

/** Frame `uSaf3`: inside a Company, a card per Provider its Employees are hired on and cannot run. */
describe('The cards, inside a Company (frame uSaf3)', () => {
  const hired = [check('claude', 'signed-out'), check('codex', 'missing')]

  it('draws a card each, each with the product’s own logo beside its title', () => {
    const drawn = cards(screen(hired))

    expect(drawn).toHaveLength(2)
    for (const one of drawn) expect(one).toMatch(/<img[^>]*height="18"/)
  })

  it('puts the footer on the last card and on no other', () => {
    const drawn = cards(screen(hired))

    expect(drawn[0]).not.toContain('Check again')
    expect(drawn[1]).toContain('Check again')
    expect(drawn[1]).toContain(PREFLIGHT_STILL_OPENS)
  })

  it('keeps the full list of products in the tagline, because only the ones in trouble are drawn', () => {
    expect(screen(hired)).toContain(preflightTagline())
  })
})
