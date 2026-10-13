import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE } from '../../../shared/domain/providers'
import type { RoleTemplate } from '../../../shared/domain/staff'
import type { Headcount } from '../../../shared/hiring'
import {
  officePlan,
  type RosterDraft,
  removeSeat,
  rosterFromPreset,
  updateSeat,
} from '../../../shared/staff/roster-draft'
import { teamPreset } from '../../../shared/staff/team-presets'
import { TeamStepView, type TeamStepViewProps } from './TeamStep'

const role = (id: string, name: string, capabilities: RoleTemplate['capabilities'] = []): RoleTemplate => ({
  id,
  name,
  persona: `${name} persona.`,
  capabilities,
  repoFilter: ['*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
})
const catalog = [
  role('pm', 'PM', ['intake', 'plan']),
  role('tech-lead', 'Tech Lead'),
  role('frontend', 'Frontend'),
  role('backend', 'Backend'),
  role('po', 'PO'),
  role('devops', 'DevOps'),
  role('qa', 'QA'),
  role('hr', 'HR'),
]
const squad = rosterFromPreset(teamPreset('product-squad'), 'claude')
const noop = () => {}

function step(
  roster: RosterDraft = squad,
  headcount: Headcount | null = { current: 0, max: 12 },
  repos = ['web-app'],
  patch: Partial<TeamStepViewProps> = {},
) {
  return renderToStaticMarkup(
    <TeamStepView
      roster={roster}
      catalog={catalog}
      plan={officePlan({ draft: roster, headcount, catalog, repos })}
      onRename={noop}
      onModel={noop}
      onRemove={noop}
      onAddRole={noop}
      suggestName={async () => null}
      {...patch}
    />,
  )
}
const text = (html: string) =>
  html
    .replace(/<option[^>]*>.*?<\/option>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

describe('Your team step', () => {
  it('draws one card per seat: initials, name, role, persona, model and remove', () => {
    const html = step()
    const shown = text(html)

    expect(shown).toContain('HE Hera PM Breaks the goal into tickets and keeps the board honest. Opus 5')
    expect(shown).toContain('OR Orion Tech Lead Guards the repo')
    expect(shown).toContain('AD Ada Frontend Small PRs')
    expect(shown).toContain('VE Vega Backend APIs, migrations')
    expect(html.match(/data-seat=/g)).toHaveLength(4)
    expect(html).toContain('aria-label="Rename Hera"')
    expect(html).toContain('aria-label="Remove Vega"')
    expect(html.match(/data-tone="(\w+)"/g)).toEqual([
      'data-tone="primary"',
      'data-tone="success"',
      'data-tone="warning"',
      'data-tone="error"',
    ])
    // Each seat shows the character it walks into the office on; initials stand in until it decodes.
    expect([...html.matchAll(/data-look="(\d+)"/g)].map(([, look]) => look)).toEqual(['0', '1', '2', '3'])
  })

  it('keeps each seat’s avatar colour when another seat is removed', () => {
    const html = step(removeSeat(squad, squad[0]!.key))

    expect(html.match(/data-tone="(\w+)"/g)).toEqual([
      'data-tone="success"',
      'data-tone="warning"',
      'data-tone="error"',
    ])
  })

  it('offers every model in the MODEL select, the seat’s own selected', () => {
    const html = step(updateSeat(squad, squad[1]!.key, { model: 'sonnet-5-fast' }))

    expect(html).toContain('aria-label="Model for Orion"')
    // Counted off the catalogue, not written down: a model added to any Provider must not be a test
    // to edit. Every Provider's models are offered, grouped under its name — a seat is not held to
    // whichever product the preset opened on (T169).
    const models = PROVIDER_CATALOGUE.flatMap((entry) => [...entry.models])
    expect(html.match(/<option /g)).toHaveLength(4 * models.length)
    expect(html.match(/<optgroup /g)).toHaveLength(4 * PROVIDER_CATALOGUE.length)
    // The option says the model and the effort the CLI is handed; the tile says the model alone.
    expect(html).toMatch(
      /aria-label="Model for Orion">(<optgroup[^>]*>|<option[^>]*>[^<]*<\/option>)*<option value="sonnet-5-fast" selected="">Sonnet 5 · low</,
    )
    expect(text(html)).toContain('Orion Tech Lead Guards the repo, reviews every PR before it reaches you. Sonnet 5')
  })

  it('names the missing roles on Add another role and lists the catalog when opened', () => {
    const closed = step()
    const open = step(squad, undefined, undefined, { catalogOpen: true })

    expect(text(closed)).toContain('Add another role — QA, DevOps, HR, PO…')
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).not.toContain('Role catalog')
    expect(text(open)).toContain(
      'PM Breaks the goal into tickets and keeps the board honest. Tech Lead Guards the repo, reviews every PR before it reaches you.',
    )
    expect(text(open)).toContain(
      'QA Tries to break every PR against its acceptance criteria. DevOps Keeps CI green and the deploys boring. HR Watches the load',
    )
  })

  it('shows Your office with desks, the first repository and the real next steps', () => {
    const shown = text(step())

    expect(shown).toContain(
      'Your office What opens when you finish setup. Desks taken 4 of 12 Repository web-app ' +
        'WHAT HAPPENS NEXT Four desks appear in the office, one sprite each. ' +
        'Hera opens #general and introduces the team. Your first ticket lands in Todo and work starts.',
    )
    expect(step()).toMatch(/data-bar="used" style="width:33.33/)
  })

  it('follows the draft: a removed PM, no repo, no maximum, too many desks', () => {
    const noPm = text(step(removeSeat(squad, squad[0]!.key), { current: 0, max: null }, []))
    const over = step(squad, { current: 1, max: 3 })

    expect(noPm).toContain('Desks taken 3 Repository None yet')
    expect(noPm).toContain('Three desks appear in the office')
    expect(noPm).toContain('Nobody takes intake yet')
    expect(step(squad, { current: 0, max: null })).not.toContain('data-bar="used"')
    expect(over).toMatch(/data-over="true">5 of 3</)
    expect(text(over)).toContain('More than the maximum headcount')
  })

  it('has no cost fields', () => {
    const shown = text(step(squad, undefined, undefined, { catalogOpen: true }))

    expect(shown).not.toMatch(/\$|\/mo|budget|cost|estimate|cap\b/i)
  })
})
