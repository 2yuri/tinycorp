import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CapacityInfo } from '../../../shared/capacity'
import type { Company } from '../../../shared/company'
import type { SavedSettings } from './settings-model'

const acme: Company = {
  id: 'c1',
  name: 'Acme Labs',
  key: 'AL',
  boss: { name: 'Grace Holt', initials: 'G' },
  folder: '/work/acme',
  createdAt: '',
}
const saved: SavedSettings = {
  company: acme,
  concurrencyCap: 3,
  autonomy: 'autonomous',
  notifications: true,
  room: 'night-studio',
  permissionMode: 'skip-permissions',
}
const capacity: CapacityInfo = { concurrencyCap: 3, running: 2, parked: ['e9'], budget: null, outages: [] }

let SettingsForm: typeof import('./CompanySettings').SettingsForm
let CompanySettings: typeof import('./CompanySettings').CompanySettings

beforeAll(async () => {
  // The page reads the preload API when its module loads; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { updates: {} } }
  ;({ SettingsForm, CompanySettings } = await import('./CompanySettings'))
})

function render(
  overrides: Partial<CapacityInfo> = {},
  removal?: { onForget(): void; onDelete(): void },
  move?: Parameters<typeof SettingsForm>[0]['move'],
  tab?: Parameters<typeof SettingsForm>[0]['tab'],
) {
  return renderToStaticMarkup(
    <SettingsForm saved={saved} capacity={{ ...capacity, ...overrides }} removal={removal} move={move} tab={tab} />,
  )
}

function mover(temporary: boolean, patch: Partial<NonNullable<Parameters<typeof SettingsForm>[0]['move']>> = {}) {
  return { isTemporary: () => temporary, moving: null, error: null, move: () => {}, ...patch }
}

describe('Company settings page', () => {
  it('shows the Company profile from the engine; the boss lives in Your profile', () => {
    const html = render()

    expect(html).toMatch(/<h2[^>]*>Company profile</)
    expect(html).toContain('value="Acme Labs"')
    expect(html).toContain('value="AL"')
    expect(html).toContain('as in AL-142.')
    // The Company's mark is a rounded square, never the circle an avatar would draw.
    expect(html).toMatch(/class="[^"]*rounded-md[^"]*"[^>]*>AL</)
    expect(html).not.toMatch(/class="[^"]*rounded-full[^"]*"[^>]*>AL</)
  })

  /**
   * The app's build is not a setting of the Company's: every Company on this Mac runs the same
   * one. It moved to Your profile's version row in T181, and `YourProfile.test.tsx` holds it there.
   */
  it('names no build and offers no update check: that is the app, not the Company', () => {
    const html = render()

    expect(html).not.toMatch(/<h2 class="settings-card__title">About</)
    expect(html).not.toContain('data-ui="Version"')
    expect(html).not.toContain('Check now')
  })

  it('shows the cap, autonomy, notifications and what runs', () => {
    const html = render()

    expect(html).toContain('value="3"')
    expect(html).toMatch(/<option value="autonomous" selected="">Autonomous</)
    expect(html).toContain('Asks only on red CI, limits and hires')
    expect(html).toContain('2 running · 1 parked.')
    expect(html).toMatch(/aria-label="Desktop notifications" checked=""/)
    expect(html).not.toContain('Out of budget')
  })

  /** Frame `QgXdU` draws one card for both: who answers you, and what the app tells you (T181). */
  it('has one Chat & notifications card, in the frame\u2019s order', () => {
    const html = render()

    expect(html).toMatch(/<h2[^>]*>Chat &amp; notifications</)
    expect(html).not.toMatch(/<h2[^>]*>Notifications</)
    expect(html).toContain('Send a test notification')
    // Company profile, then Chat & notifications: the frame's left column, in order.
    expect(html.indexOf('Company profile')).toBeLessThan(html.indexOf('Chat &amp; notifications'))
    // The Team card opens the right column, and the Danger zone closes it.
    expect(html.indexOf('Chat &amp; notifications')).toBeLessThan(html.indexOf('>Team<'))
  })

  /**
   * Which CLI is installed and which login it holds is a fact about this Mac and this person, not
   * about a Company: all four Companies here get the same answer, and nothing about it can be set
   * per Company. It lives in Your profile (T141). What stays is Integrations — the MCP servers and
   * skills *this* Company's Employees may use, which two Companies really do want differently.
   */
  it('has no Providers section: the CLIs on this Mac belong to Your profile', () => {
    const html = render()

    expect(html).not.toMatch(/<h2 class="settings-card__title">Providers</)
    expect(html).not.toContain('data-ui="Provider Status"')
    expect(html).not.toContain('Check again')
  })

  it('keeps Integrations, which really is per-Company', () => {
    const html = renderToStaticMarkup(<CompanySettings company={acme} tab="integrations" />)

    expect(html).toMatch(/aria-selected="true"[^>]*>Integrations</)
  })

  it("leads Autonomy with the design's shield-check", () => {
    expect(render()).toMatch(/lucide-shield-check[^>]*data-slot="field-icon"[^>]*>.*<select/s)
  })

  it('ships the three tabs the decisions kept, and none of the three they dropped', () => {
    const html = renderToStaticMarkup(<CompanySettings company={acme} />)

    expect(html).toContain('role="tablist"')
    expect(html).toMatch(/aria-selected="true"[^>]*>General</)
    expect(html).toMatch(/aria-selected="false"[^>]*>Office</)
    // Integrations is the design's own tab, built for the MCP catalogue (T136, frame `uApL8`).
    expect(html).toMatch(/aria-selected="false"[^>]*>Integrations</)
    for (const dropped of ['Team &amp; seats', 'Budget', 'Guardrails']) {
      expect(html, dropped).not.toContain(dropped)
    }
  })

  it('opens the Office tab when the route names it', () => {
    const html = renderToStaticMarkup(<CompanySettings company={acme} tab="office" />)

    expect(html).toMatch(/aria-selected="true"[^>]*>Office</)
    expect(html).toMatch(/aria-selected="false"[^>]*>General</)
  })

  it('says when the team is out of budget', () => {
    const html = render({ budget: { exhaustedAt: '2026-09-17T10:00:00Z', resetsAt: null } })

    expect(html).toContain('Out of budget')
    expect(html).toContain('The reset time is unknown.')
  })

  it('shows no field errors for the saved settings', () => {
    // The modifier as the kit applies it, right after the base class: the field's own class list
    // also *names* `data-error="true"`, inside the variant that styles an errored control.
    expect(render()).not.toContain('data-error="true"')
  })

  it('offers Remove from launcher and Delete company… in the Danger zone', () => {
    const noop = () => {}
    const html = render({}, { onForget: noop, onDelete: noop })

    expect(html).toContain('aria-label="Danger zone"')
    expect(html).toMatch(/data-variant="outline"[^>]*>.*Remove from launcher/)
    expect(html).toMatch(/data-variant="destructive"[^>]*>.*Delete company…/)
    expect(render()).not.toContain('Danger zone')
  })

  it('warns about a temporary Company folder and offers Move…', () => {
    const html = render({}, undefined, mover(true))

    expect(html).toContain('data-variant="warning"')
    expect(html).toContain('This company lives in a temporary folder and can be lost on restart')
    expect(html).toMatch(/<button[^>]*>.*Move…<\/span><\/button>/)
  })

  it('shows no warning for a folder that is not temporary', () => {
    expect(render({}, undefined, mover(false))).not.toContain('temporary folder')
    expect(render()).not.toContain('temporary folder')
  })

  it('keeps the folder warning on General: the Office tab is about the room', () => {
    expect(render({}, undefined, mover(true), 'office')).not.toContain('temporary folder')
    expect(render({}, undefined, mover(true), 'general')).toContain('temporary folder')
  })

  it('shows a move in progress and a failed move', () => {
    const busy = render({}, undefined, mover(true, { moving: 'c1' }))
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>.*Moving…<\/span><\/button>/)

    const failed = render({}, undefined, mover(true, { error: { companyId: 'c1', message: '/x already exists' } }))
    expect(failed).toMatch(/<span[^>]*>\/x already exists<\/span>/)
  })
})
