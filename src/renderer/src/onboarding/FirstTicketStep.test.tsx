import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RoleTemplate } from '../../../shared/domain/staff'
import { rosterFromPreset } from '../../../shared/staff/roster-draft'
import { teamPreset } from '../../../shared/staff/team-presets'
import { draftPlanner, FirstTicketStepView, type FirstTicketStepViewProps, plannerLabel } from './FirstTicketStep'

const noop = () => {}
const goal =
  'Ship a checkout page that takes a card, handles an expired token without losing the cart, and has tests for both paths.'

function step(patch: Partial<FirstTicketStepViewProps> = {}) {
  return renderToStaticMarkup(
    <FirstTicketStepView
      goal={goal}
      onGoal={noop}
      repo={{ name: 'web-app', more: 0 }}
      planner="Hera"
      onEmptyBoard={noop}
      {...patch}
    />,
  )
}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const role = (id: string, capabilities: RoleTemplate['capabilities']): RoleTemplate => ({
  id,
  name: id,
  persona: '',
  capabilities,
  repoFilter: [],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
})
const catalog = [
  role('pm', ['intake', 'plan', 'hire']),
  role('tech-lead', ['code', 'review']),
  role('frontend', ['code']),
]

describe('First ticket step', () => {
  it('shows the goal field with the repo chip and who plans it', () => {
    const html = step()

    expect(html).toMatch(/<textarea[^>]*aria-label="First goal"[^>]*>Ship a checkout page/)
    expect(text(html)).toContain('web-app Hera plans it')
    expect(html).toContain('data-tag="repo"')
  })

  it('offers three suggestions that fill the field, the or divider and Open with an empty board', () => {
    const shown = text(step())

    expect(shown).toContain('Set up CI and a preview deploy Add auth with magic links Migrate the API to Postgres')
    expect(shown).toContain(
      'or Open with an empty board The team clocks in and waits. You can drop a ticket whenever you are ready.',
    )
  })

  it('shows no estimate and no money', () => {
    const shown = text(step())

    expect(shown).not.toMatch(/\$|estimate|tokens|cost|price/i)
  })

  it('counts the other connected repos, and hides the repo chip without one', () => {
    expect(text(step({ repo: { name: 'web-app', more: 2 } }))).toContain('web-app +2')
    expect(step({ repo: null })).not.toContain('data-tag="repo"')
  })

  it('names the intake holder from the draft, or says the goal goes to #general', () => {
    const squad = rosterFromPreset(teamPreset('product-squad'), 'claude')

    expect(draftPlanner(squad, catalog)).toBe('Hera')
    expect(draftPlanner(squad.slice(1), catalog)).toBeNull()
    expect(plannerLabel(null)).toBe('Posted in #general')
    expect(text(step({ planner: null }))).toContain('Posted in #general')
  })

  it('holds every action while Finish runs', () => {
    const html = step({ busy: true })

    expect(html.match(/disabled=""/g)).toHaveLength(5)
  })
})
