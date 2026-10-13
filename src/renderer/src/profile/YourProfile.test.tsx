import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultBoss } from '../../../shared/boss-profile'
import type { Company, CompanySummary } from '../../../shared/company'
import { FALLBACK_PROVIDER, PROVIDER_AUTH, PROVIDER_LABEL, PROVIDERS } from '../../../shared/domain/providers'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import type { SavedProfile } from './profile-model'

const acme: Company = {
  id: 'c1',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Yuri Miguel', initials: 'YM', handle: 'yuri', sprite: 1, status: 'available' },
  folder: '/work/tiny',
  createdAt: '2026-03-04T10:00:00.000Z',
}

function summary(over: Partial<CompanySummary> & Pick<CompanySummary, 'id' | 'name'>): CompanySummary {
  return {
    key: 'XX',
    boss: acme.boss,
    folder: `/work/${over.id}`,
    createdAt: acme.createdAt,
    open: false,
    current: false,
    employees: 3,
    sessions: 0,
    lastOpenedAt: null,
    onboardingCompletedAt: null,
    missing: false,
    databaseElsewhere: false,
    ...over,
  }
}

const companies = [
  summary({ id: 'c1', name: 'Tiny Corp', employees: 8, current: true, open: true }),
  summary({ id: 'c2', name: 'Atlas Studio', employees: 3 }),
]

const saved: SavedProfile = {
  boss: { ...defaultBoss('Yuri Miguel', 'boss@example.com'), handle: 'yuri', sprite: 1 },
  notifications: true,
}

const NOW = Date.UTC(2026, 8, 18, 12)

let ProfileForm: typeof import('./YourProfile').ProfileForm
let SpritePicker: typeof import('./YourProfile').SpritePicker
let SIGN_OUT_NOTE: string

beforeAll(async () => {
  // The page reads the preload API and the build's version when its module loads.
  // The Provider card reads the usage query (T80); a ready Provider keeps the card in its normal state.
  const usage = {
    providers: [
      {
        id: FALLBACK_PROVIDER,
        name: PROVIDER_LABEL[FALLBACK_PROVIDER],
        windows: [
          { id: 'five_hour', label: '5h', percent: 6, resetsAt: new Date(NOW + 4 * 3600_000).toISOString() },
          { id: 'seven_day', label: 'wk', percent: 15, resetsAt: new Date(NOW + 4 * 86_400_000).toISOString() },
        ],
        problem: null,
        reason: null,
      },
    ],
    readAt: new Date(NOW).toISOString(),
  }
  ;(globalThis as { window?: unknown }).window = {
    tinyCorp: {
      capacity: { onChanged: () => () => {} },
      usage: { read: async () => ({ ok: true, value: usage }), onChanged: () => () => {} },
      // The Providers card asks about every Provider on this Mac, not only the ones hired here.
      preflight: { all: async () => [], onChanged: () => () => {} },
    },
  }
  ;(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = '0.4.2'
  ;({ ProfileForm, SpritePicker, SIGN_OUT_NOTE } = await import('./YourProfile'))
})

function render(over: Partial<SavedProfile> = {}) {
  return renderToStaticMarkup(
    <ProfileForm
      saved={{ ...saved, ...over }}
      company={acme}
      companies={companies}
      onNavigate={() => {}}
      onOpenCompany={() => {}}
      now={NOW}
    />,
  )
}

describe('Your profile', () => {
  it('shows the identity card: name, handle, locked account email and what a handle does', () => {
    const html = render()

    expect(html).toContain('Yuri Miguel')
    expect(html).toContain('value="@yuri"')
    expect(html).toContain('boss@example.com')
    expect(html).toContain('readOnly=""')
    expect(html).toContain(
      'Employees address you by your handle — @yuri in any channel wakes nobody but reaches your desk.',
    )
    expect(html).toContain('Running Tiny Corp since March')
    expect(html).toContain('Boss · Owner')
  })

  it('offers every character and outlines the one the boss is drawn with', () => {
    const html = renderToStaticMarkup(<SpritePicker value={2} initials="YM" onPick={() => {}} />)

    expect([...html.matchAll(/aria-label="Character \d+"/g)]).toHaveLength(CHARACTER_SHEETS)
    expect(html).toMatch(/aria-label="Character 3"[^>]*checked=""/)
    expect([...html.matchAll(/checked=""/g)]).toHaveLength(1)
    // The sheet has not decoded in a static render, so the initials stand in (T79).
    expect(html).toContain('YM')
  })

  it('lists the three statuses with the design’s wording and marks the one in force', () => {
    const html = render({ boss: { ...saved.boss, status: 'focused' } })

    expect(html).toContain('Employees DM you directly and notifications arrive as they happen.')
    expect(html).toContain('Only approvals break through. Mentions and DMs wait at your desk.')
    expect(html).toContain('Nothing interrupts. Everything collects at your desk until you are back.')
    expect(html).toContain('data-status="focused"')
    // The status in force takes the frame's stronger stroke and the card surface.
    expect(html).toMatch(/border-\[#475569\] bg-card" data-status="focused"/)
    expect(html).toContain('Never — until I change it')
  })

  it('shows the notification toggles, the link to the per-Company ones and the app version', () => {
    const html = render()

    expect(html).toContain('Show notifications')
    expect(html).toContain('Play a sound')
    expect(html).toContain('Per-Company toggles live in Company settings')
    expect(html).toContain('tinycorp 0.4.2')
    expect(html).toContain('Sign out')
  })

  it.each([
    ['darwin', 'Notifications on this Mac'],
    ['win32', 'Notifications on this PC'],
    ['linux', 'Notifications on this computer'],
  ])('names the machine the notifications are on: %s says "%s" (T265)', (platform, title) => {
    const tinyCorp = (globalThis as { window: { tinyCorp: { shell?: unknown } } }).window.tinyCorp
    tinyCorp.shell = { platform }
    try {
      const html = render()

      expect(html).toContain(`>${title}</h3>`)
      expect(html).toContain(`aria-label="${title}"`)
    } finally {
      delete tinyCorp.shell
    }
  })

  /**
   * The build is the app's, not a Company's: every Company on this Mac runs the same one, so the
   * version row is here and not in Company settings (T181, frame `Oykzs`). `docs/beta.md` sends
   * testers to this row when it asks them which build they are on.
   */
  it('is where the version row lives: the build, and a Check now beside it', () => {
    const html = render()

    expect(html).toContain('data-ui="Version"')
    expect(html).toContain('Check now')
  })

  it('lists every Provider the catalogue knows, not only the one the boss signed in with', () => {
    const html = render()

    // The card is about this machine (T141), so a Provider nobody here is hired on is still a box.
    for (const id of PROVIDERS) expect(html).toContain(PROVIDER_LABEL[id])
    expect(html).toContain('Every Employee runs on your own login — never an API key.')
    expect([...html.matchAll(/data-provider="/g)]).toHaveLength(PROVIDERS.length)
    // Both reads land after the first paint, so a static render is every row still asking — and
    // never a meter drawn over numbers nobody has (`providers-card.test.ts` holds the rest).
    expect([...html.matchAll(/data-ui="Provider Badge"/g)]).toHaveLength(PROVIDERS.length)
    expect(html).not.toContain('role="progressbar"')
  })

  it('lists the Companies with their role and headcount, the open one marked', () => {
    const html = render()

    expect(html).toContain('Owner · 8 Employees')
    expect(html).toContain('Owner · 3 Employees')
    expect(html).toContain('>Open<')
    // The open Company keeps the muted fill under it, and carries `aria-current`.
    expect(html).toContain('aria-current="true"')
  })

  it('says who owns the logins instead of inventing a sign out, and names every one of them', () => {
    // Each CLI holds its own login, so the note carries each one's own command (T141).
    for (const id of PROVIDERS) expect(SIGN_OUT_NOTE).toContain(PROVIDER_AUTH[id].signOut)
    expect(SIGN_OUT_NOTE).toContain('TinyCorp keeps no account of its own')
  })

  it('does not say twice what the Providers card beside it already says', () => {
    // The card names the logins; the note says who owns them and what ends them.
    expect(SIGN_OUT_NOTE).not.toContain('The CLIs on this Mac')
    expect(SIGN_OUT_NOTE).not.toMatch(/never an API key/)
    expect(SIGN_OUT_NOTE).not.toContain(PROVIDER_LABEL[FALLBACK_PROVIDER])
  })

  it('falls back to the initials while the character sheet has not decoded', () => {
    const html = render()

    expect(html).toContain('>YM<')
  })
})

describe('the sprite picker', () => {
  it('scrolls instead of squeezing, so the sheet can grow past what the card fits', () => {
    const source = readFileSync(join(import.meta.dirname, 'YourProfile.tsx'), 'utf8')
    const list = (name: string) => new RegExp(`^const ${name} =\\s*\\n?\\s*'([^']*)'`, 'm').exec(source)?.[1] ?? ''

    expect(list('SPRITES')).toContain('overflow-x-auto')
    // A fixed tile: with `flex: 1 1 0` every extra character made them all thinner. Its width is a
    // sixth of the row, so the frame's six fill it and a seventh scrolls in (T148).
    expect(list('SPRITE')).toContain('shrink-0 grow-0 basis-[calc((100%-5*10px)/6)]')
  })
})
