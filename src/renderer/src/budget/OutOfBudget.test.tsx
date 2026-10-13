import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OfficeActions, officeHeaderFacts } from '../office-view'
import {
  BudgetBadge,
  BudgetOverlay,
  budgetSubtitle,
  budgetTitle,
  NO_FALLBACK_NOTE,
  workingSessions,
} from './OutOfBudget'

const now = new Date(2026, 8, 17, 11, 48)
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('out-of-budget state', () => {
  it('shows the designed card bound to the reset time', () => {
    const budget = {
      exhaustedAt: new Date(2026, 8, 17, 11, 0).toISOString(),
      resetsAt: new Date(2026, 8, 17, 14, 0).toISOString(),
    }
    const html = renderToStaticMarkup(
      <BudgetOverlay
        budget={budget}
        now={now}
        onWait={() => {}}
        continueOn={{ name: 'Codex', onContinue: () => {} }}
      />,
    )

    expect(text(html)).toBe(
      'The subscription limit is reached ' +
        'Every Employee walked to the coffee area. Sessions stay alive and resume on their own ticket the moment ' +
        'your limit resets — nothing is lost, no work is dropped. ' +
        // Nobody presses anything at 14:00: the app scheduled the return when the limit was hit (T173).
        'Back at 14:00 automatically · in 2h 12m ' +
        'Wait for the reset Continue on Codex now ' +
        'Resume automatically at reset is on in Company settings.',
    )
  })

  it('says where to set a fallback when the Company names none', () => {
    const html = renderToStaticMarkup(
      <BudgetOverlay budget={{ exhaustedAt: now.toISOString(), resetsAt: null }} now={now} onWait={() => {}} />,
    )

    expect(html).toMatch(/aria-disabled="true"[^>]*>.*Continue on another provider/)
    expect(text(html)).toContain('Reset time unknown · trying again at 12:48 · in 1h 0m')
    // The reason there is nowhere to continue is on the button itself, not a second line of prose.
    expect(html).toContain(`title="${NO_FALLBACK_NOTE.replace('&', '&amp;')}"`)
  })

  it('does not promise a return the Company will not make on its own', () => {
    const budget = {
      exhaustedAt: new Date(2026, 8, 17, 11, 0).toISOString(),
      resetsAt: new Date(2026, 8, 17, 14, 0).toISOString(),
    }
    const html = renderToStaticMarkup(
      <BudgetOverlay budget={budget} now={now} onWait={() => {}} resumesAutomatically={false} />,
    )

    expect(text(html)).toContain('Resets at 14:00 · in 2h 12m')
    expect(text(html)).not.toContain('automatically')
  })

  it('titles the window and badges the header', () => {
    expect(budgetTitle('Acme')).toBe('Acme — out of budget')
    expect(text(renderToStaticMarkup(<BudgetBadge />))).toBe('Out of budget')
  })

  it('says where the team is and counts only Sessions that can work', () => {
    expect(budgetSubtitle('Acme')).toBe('Acme · everyone is in the coffee area')
    expect(workingSessions({ a: 'out_of_budget', b: 'out_of_budget', c: 'off', d: 'parked' })).toBe(0)
    expect(workingSessions({ a: 'busy', b: 'idle', c: 'starting', d: 'out_of_budget' })).toBe(3)
  })

  it('turns the Sessions pill red in the Office header', () => {
    const html = renderToStaticMarkup(
      <OfficeActions
        floor="Acme"
        facts={officeHeaderFacts([])}
        capacity={{ running: 0, concurrencyCap: 5 }}
        canPause
        onPauseAll={() => {}}
        onHire={() => {}}
        outOfBudget
      />,
    )

    expect(html).toContain('data-out-of-budget="true"')
    expect(text(html)).toContain('0 / 5 Sessions running')
  })
})
