import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { PROVIDERS, type Provider } from '../../../shared/domain/providers'
import { modelLabel } from '../../../shared/staff/models'
import { rosterFromPreset } from '../../../shared/staff/roster-draft'
import { presetModel, teamPreset } from '../../../shared/staff/team-presets'
import { FirstTicketStepView } from './FirstTicketStep'
import { SetupWizardView, type SetupWizardViewProps, setupTitle } from './SetupWizard'
import { restoreWizard, wizardStart } from './wizard-model'

const company: Company = {
  id: 't',
  name: 'Tiny Corp',
  key: 'TC',
  boss: { name: 'Ada', initials: 'AD' },
  folder: '/Users/ada/code/tinycorp',
  createdAt: '2026-09-17T00:00:00.000Z',
}

const noop = () => {}
function wizard(patch: Partial<SetupWizardViewProps> = {}) {
  return renderToStaticMarkup(
    <SetupWizardView
      company={company}
      state={wizardStart('claude')}
      autonomy="managed"
      provider="claude"
      onPreset={noop}
      onBack={noop}
      onContinue={noop}
      onSkip={noop}
      {...patch}
    />,
  )
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('Setup wizard', () => {
  it('titles the window `<Company> — Setup` and shows the Company name and path in the rail', () => {
    const shown = text(wizard())

    expect(setupTitle('Tiny Corp')).toBe('Tiny Corp — Setup')
    expect(shown).toContain('Tiny Corp — Setup')
    expect(shown).toContain('Tiny Corp ~/code/tinycorp')
  })

  it('numbers the steps, with Company done and Team preset current', () => {
    const html = wizard()

    expect(text(html)).toContain(
      'Company Named and pointed at a folder 2 Team preset Pick the shape of the office 3 Your team Names and models 4 Repositories Where the work actually happens 5 First ticket Give them something to build',
    )
    expect(html).toMatch(/data-status="done"><span[^>]*><svg[^>]*aria-label="Done"/)
    expect(html).toMatch(/data-status="current" aria-current="step"><span[^>]*>2</)
    expect(html.match(/data-status="todo"/g)).toHaveLength(3)
    expect(text(html)).toContain('Nothing here is permanent — hire, fire and retune from Company settings.')
  })

  it('shows the Team preset head, four cards with Product squad selected, and no prices', () => {
    const html = wizard()
    const shown = text(html)

    expect(shown).toContain('STEP 2 OF 5 How should the office start? Pick a shape for the team.')
    expect(shown).toContain('Solo builder One senior generalist')
    expect(shown).toContain('Tech Lead 1 seat')
    expect(shown).toContain('Product squad Selected A PM to break work down')
    expect(shown).toContain('PM Tech Lead Frontend Backend 4 seats')
    expect(shown).toContain('+ QA + DevOps + HR + PO 8 seats')
    expect(shown).toContain('Nobody yet 0 seats')
    expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1)
    expect(html).toMatch(/data-selected="true">.*?Product squad/)
    expect(shown).not.toMatch(/\$|\/mo|estimate/i)
  })

  it('reads the defaults line from the preset model of the Provider this Mac runs, and the autonomy', () => {
    // Off the catalogue, never written down: the line follows the Provider the wizard was handed.
    const shown = (provider: Provider) => modelLabel(provider, presetModel(provider))

    for (const provider of PROVIDERS) {
      expect(text(wizard({ provider }))).toContain(
        `Everyone starts on your company defaults — ${shown(provider)}, Managed autonomy. You tune each one in the next step.`,
      )
    }
    expect(text(wizard({ autonomy: 'supervised' }))).toContain(`${shown('claude')}, Supervised autonomy.`)
  })

  it('offers Skip setup, Back (disabled on the first step) and Continue', () => {
    const html = wizard()

    expect(text(html)).toContain('Skip setup Back Continue')
    expect(html).toMatch(/data-action="back" disabled="">/)
  })

  it('draws the later steps’ heads and ends with Open the office', () => {
    const studio = rosterFromPreset(teamPreset('full-studio'), 'claude')
    const team = text(wizard({ state: { step: 'team', preset: 'full-studio', roster: studio, goal: '' } }))
    const one = text(wizard({ state: { step: 'team', preset: 'full-studio', roster: studio.slice(0, 1), goal: '' } }))
    const last = wizard({ state: { ...wizardStart('claude'), step: 'first-ticket' } })

    expect(team).toContain('STEP 3 OF 5 Your starting team Eight employees from the Full studio preset.')
    expect(one).toContain('Your starting team One employee from the Full studio preset.')
    expect(text(last)).toContain('STEP 5 OF 5 Give them something to build')
    expect(text(last)).toMatch(/Back Open the office $/)
    expect(last).not.toContain('Skip setup')
    expect(last.match(/data-status="done"/g)).toHaveLength(4)
  })

  it('centres the First ticket step, names who plans the goal and opens the office with the door icon', () => {
    const html = wizard({ state: { ...wizardStart('claude'), step: 'first-ticket', goal: 'Ship it' }, planner: 'Hera' })

    expect(html).toContain('data-centred="true"')
    expect(text(html)).toContain(
      'Describe the outcome in a sentence. Hera breaks it into tickets, the board fills up and the office starts moving.',
    )
    expect(html).toContain('lucide-door-open')
  })

  it('reopens on the step the boss left, with the goal they had typed (T59)', () => {
    const state = restoreWizard(
      {
        step: 'first-ticket',
        preset: 'solo-builder',
        roster: rosterFromPreset(teamPreset('solo-builder'), 'claude'),
        goal: 'Add auth with magic links',
      },
      'claude',
    )

    const html = wizard({
      state,
      planner: 'Orion',
      children: <FirstTicketStepView goal={state.goal} onGoal={noop} repo={null} planner="Orion" onEmptyBoard={noop} />,
    })

    expect(text(html)).toContain('STEP 5 OF 5 Give them something to build')
    expect(html).toContain('Add auth with magic links')
    expect(html.match(/data-status="done"/g)).toHaveLength(4)
    // The wizard was reopened, not restarted: Open the office is one click away.
    expect(text(html)).toMatch(/Back Open the office $/)
  })

  it('reopens mid-wizard with the steps behind it done and Back working', () => {
    const html = wizard({
      state: restoreWizard(
        {
          step: 'repositories',
          preset: 'full-studio',
          roster: rosterFromPreset(teamPreset('full-studio'), 'claude'),
          goal: '',
        },
        'claude',
      ),
    })

    expect(text(html)).toContain('STEP 4 OF 5 Which repositories can they touch?')
    expect(html.match(/data-status="done"/g)).toHaveLength(3)
    expect(html).toContain('Skip setup')
    expect(html).not.toMatch(/data-action="back" disabled=""/)
  })

  it('shows why Finish failed', () => {
    const html = wizard({
      state: { ...wizardStart('claude'), step: 'first-ticket' },
      error: 'Setup is already finished',
    })

    expect(html).toMatch(/role="alert">Setup is already finished</)
  })
})
