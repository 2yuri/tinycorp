import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Employee } from '../../../shared/domain/staff'
import { accentFor } from '../ui'
import { NameField, ProposalForm } from './forms'
import type { HireProposal } from './model'
import { EmployeeCard, EmployeesActions, HireProposalPanel } from './parts'

const noop = () => {}

const vega: Employee = {
  id: 'e1',
  name: 'Vega',
  roleId: 'frontend',
  title: 'Frontend',
  persona: 'Lives in the component layer.',
  capabilities: ['code', 'review'],
  repoFilter: ['web-app'],
  areas: [],
  mcpServers: [],
  skills: [],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: null,
  overrides: [],
  desk: 0,
  sprite: 0,
  createdAt: '',
}

/** What every element of one kit slot says: `data-slot` is the hook the kit hands the DOM (T216). */
const texts = (html: string, slot: string) =>
  [...html.matchAll(new RegExp(`data-slot="${slot}"[^>]*>(?:<input[^>]*>)?([^<]*)<`, 'g'))].map((m) => m[1])

/** The chips a card's row draws, in the order they are drawn. */
const chipRow = (html: string) => {
  const row = html.slice(html.indexOf('data-ui="Chip Row"'), html.indexOf('</article>'))
  return [...row.matchAll(/data-ui="Chip"[^>]*>(?:<svg[\s\S]*?<\/svg>)?(?:<span[^>]*>)?([^<]*)</g)].map((m) => m[1])
}

/** One part of the UI, by the `data-ui` name it carries rather than by a class it is drawn with. */
const parts = (html: string, ui: string) =>
  [...html.matchAll(new RegExp(`data-ui="${ui}"[^>]*>([^<]*)<`, 'g'))].map((m) => m[1])

/** The EFFORT level drawn as the current one: inside that control, the label whose radio is checked. */
const currentEffort = (html: string) => {
  const track = html.slice(html.indexOf('aria-label="Effort"'))
  return [...track.matchAll(/<label[^>]*><input[^>]*checked[^>]*>([^<]*)</g)]
    .map((match) => match[1])
    .filter((word) => word !== '')
}

describe('EmployeeCard', () => {
  it('shows the avatar, name, role, state, persona, capability chips and repo chips', () => {
    const html = renderToStaticMarkup(
      <EmployeeCard
        employee={vega}
        state={{ label: 'Working', tone: 'success', dimmed: false }}
        repos={['web-app', '+1']}
        onOpen={noop}
      />,
    )

    expect(texts(html, 'avatar-initials')).toEqual(['VE'])
    expect(html).toContain(`data-accent="${accentFor(vega.id)}"`)
    expect(parts(html, 'Name')).toEqual(['Vega'])
    expect(parts(html, 'Role')).toEqual(['Frontend'])
    expect(parts(html, 'Pill')).toEqual(['Working'])
    expect(html).toContain('bg-brand-success')
    expect(parts(html, 'Persona')).toEqual(['Lives in the component layer.'])
    expect(chipRow(html)).toEqual(['code', 'review', 'web-app', '+1'])
    // The repo chip carries a folder glyph; the `+1` that stands for the rest does not.
    expect(html).toMatch(/data-ui="Chip"[^>]*><svg[\s\S]*?<\/svg><span[^>]*>web-app</)
    expect(html).toMatch(/data-ui="Chip"[^>]*><span[^>]*>\+1</)
    expect(html).toContain('aria-label="Open Vega"')
    expect(html).not.toContain('opacity-78')
  })

  it('keeps the model out of the chip row, as the design does: capabilities, a spacer, then repos', () => {
    const html = renderToStaticMarkup(
      <EmployeeCard
        employee={{ ...vega, model: 'opus-5-balanced' }}
        state={{ label: 'Working', tone: 'success', dimmed: false }}
        repos={['all repos']}
      />,
    )

    // The row's own children, in order: two capabilities, the spacer, then the repos.
    const row = html.slice(html.indexOf('data-ui="Chip Row"'), html.indexOf('</article>'))
    expect([...row.matchAll(/data-ui="(Chip|Spacer)"/g)].map((m) => m[1])).toEqual(['Chip', 'Chip', 'Spacer', 'Chip'])
    expect(html).not.toContain('Opus 5')
    expect(html).not.toContain('Default model')
  })

  /**
   * T239: the chip row already said `no repos`; what it never said is what that costs. A card whose
   * Employee no repo filter lets in carries the sentence, and only then.
   */
  it('says when this Employee can work in no repo of the Company', () => {
    const shut = renderToStaticMarkup(
      <EmployeeCard
        employee={vega}
        state={{ label: 'Idle', tone: 'muted', dimmed: false }}
        repos={['no repos']}
        shutOut="Vega can’t work in any of this Company’s repos"
      />,
    )
    const fine = renderToStaticMarkup(
      <EmployeeCard employee={vega} state={{ label: 'Idle', tone: 'muted', dimmed: false }} repos={['web-app']} />,
    )

    // The line carries a warning glyph, so its text is read off the row rather than off one element.
    const line = shut.slice(shut.indexOf('data-ui="Shut Out"'), shut.indexOf('</article>'))
    expect(line).toContain('Vega can’t work in any of this Company’s repos')
    expect(line).toContain('text-status-warning-foreground')
    expect(fine).not.toContain('data-ui="Shut Out"')
  })

  it('fades parked and off Employees', () => {
    const html = renderToStaticMarkup(
      <EmployeeCard
        employee={vega}
        state={{ label: 'Parked', tone: 'muted', dimmed: true }}
        repos={[]}
        onOpen={noop}
      />,
    )

    expect(html).toContain('opacity-78')
    expect(html).toContain('bg-brand-text-muted')
  })
})

describe('EmployeesActions', () => {
  it('offers the concurrency cap and Hire Employee', () => {
    const html = renderToStaticMarkup(
      <EmployeesActions
        capacity={{ concurrencyCap: 5, running: 5, parked: [], budget: null, outages: [] }}
        onSetCap={noop}
        onHire={noop}
      />,
    )

    expect(texts(html, 'button-label')).toEqual(['Concurrency cap', 'Hire Employee'])
    expect(html).toMatch(/data-variant="primary"[\s\S]*Hire Employee/)
  })
})

describe('HireProposalPanel', () => {
  const proposal: HireProposal = {
    approval: {
      id: 7,
      action: 'hire',
      requesterId: 'hera',
      subject: 'a new Frontend named Lyra',
      ticketId: null,
      pullRequest: null,
      reason: 'Frontend is the bottleneck.',
      status: 'pending',
      decisionReason: null,
      channelId: 'general',
      messageId: 1,
      createdAt: '',
      decidedAt: null,
    },
    requestId: 3,
    proposal: null,
    requester: { name: 'Hera', label: 'HR · hire', person: { id: 'e-hera', sprite: 1 } },
    candidate: {
      name: 'Lyra',
      person: null,
      named: true,
      roleId: 'frontend',
      roleName: 'Frontend',
      roleLine: 'Frontend · from the role catalog',
      persona: 'Pairs with Vega.',
      capabilities: ['code'],
      repoFilter: ['web-app'],
      provider: 'Claude Code',
      providerId: 'claude',
      requestId: 3,
      model: 'sonnet-5-balanced',
      modelLabel: 'Sonnet 5 · balanced',
    },
    pendingCount: 1,
  }

  it('lays out the proposal as designed, top to bottom', () => {
    const html = renderToStaticMarkup(
      <HireProposalPanel
        proposal={proposal}
        channelName="general"
        time="09:48"
        load={[{ label: 'Frontend WIP', value: '3 / 3 breached', strong: true }]}
        repos={['web-app']}
        autonomy="Managed — hires and merges always ask you first"
        effect="Approving starts a Session."
        error={null}
        onApprove={noop}
        onReject={noop}
        onModel={noop}
      />,
    )

    expect(parts(html, 'Panel Title')).toEqual(['Hire proposal'])
    expect(parts(html, 'Panel Subtitle')).toEqual(['#general · thread from Hera'])
    expect(parts(html, 'Pill')).toEqual(['Pending'])
    expect(parts(html, 'Message Role')).toEqual(['HR · hire'])
    expect(parts(html, 'Message Text')).toEqual(['Frontend is the bottleneck.'])
    expect(html).toContain('TEAM LOAD · read from the board')
    // The breached row is the one set bold.
    expect(html).toMatch(/data-ui="Load Value"[^>]*font-bold[^>]*>3 \/ 3 breached</)
    expect(parts(html, 'Name')).toEqual(['Lyra'])
    expect(parts(html, 'Candidate Role')).toEqual(['Frontend · from the role catalog'])
    expect(html).toMatch(
      /aria-label="Edit the proposed Employee"[^>]*disabled|disabled[^>]*aria-label="Edit the proposed Employee"/,
    )
    expect(parts(html, 'Chip')).toEqual(['code', 'web-app', 'Claude Code', 'Sonnet 5 · balanced'])
    // One control, closed: the provider as a chip, the model, the effort as a badge (frame `CLSj9`).
    expect(parts(html, 'Provider Name')).toEqual(['Claude Code'])
    expect(parts(html, 'Model Name')).toEqual(['Sonnet 5'])
    expect(currentEffort(html)).toEqual(['medium'])
    expect(html).not.toContain('<option')
    expect(parts(html, 'Autonomy')).toEqual(['Managed — hires and merges always ask you first'])
    expect(parts(html, 'Effect')).toEqual(['Approving starts a Session.'])
    expect(texts(html, 'button-label')).toEqual(['Reject', 'Approve &amp; hire'])
    // The requester is an Employee, so they bring their accent; a candidate with no id yet has none.
    expect(html).toContain(`data-accent="${accentFor('e-hera')}"`)
    expect(html.match(/data-accent=/g)).toHaveLength(1)
  })

  it('lets the boss edit a new-hire proposal and warns above the maximum headcount', () => {
    const html = renderToStaticMarkup(
      <HireProposalPanel
        proposal={proposal}
        channelName="general"
        time="09:48"
        load={null}
        repos={['web-app']}
        autonomy={null}
        headcount="Hiring Lyra makes 8 Employees, above the maximum headcount of 7."
        effect={null}
        error={null}
        onApprove={noop}
        onReject={noop}
        onModel={noop}
        onEdit={noop}
      />,
    )

    expect(html).toMatch(/<button[^>]*aria-label="Edit the proposed Employee"[^>]*>/)
    expect(html.match(/<button[^>]*aria-label="Edit the proposed Employee"[^>]*>/)![0]).not.toContain('disabled=""')
    expect(parts(html, 'Chip')).toEqual(['code', 'web-app', 'Claude Code', 'Sonnet 5 · balanced'])
    expect(texts(html, 'alert-title')).toEqual(['Above the maximum headcount'])
    expect(texts(html, 'alert-body')).toEqual(['Hiring Lyra makes 8 Employees, above the maximum headcount of 7.'])
  })
})

describe('ProposalForm', () => {
  it('starts from the stored proposal, with a shuffle next to the name', () => {
    const html = renderToStaticMarkup(
      <ProposalForm
        proposal={{
          name: 'Lyra',
          roleId: 'frontend',
          persona: 'Pairs with Vega.',
          capabilities: ['code'],
          repoFilter: ['web-app', 'payments-web'],
          areas: [],
          model: 'opus-5-deep',
        }}
        roles={[
          {
            id: 'frontend',
            name: 'Frontend',
            persona: '',
            capabilities: ['code'],
            repoFilter: ['*'],
            areas: [],
            mcpServers: [],
            skills: [],
            seeded: true,
          },
        ]}
        error={null}
        suggestName={async () => 'Nova'}
        onSave={noop}
        onCancel={noop}
      />,
    )

    expect(parts(html, 'Panel Title')).toEqual(['Edit Lyra'])
    expect(html).toContain('value="Lyra"')
    expect(parts(html, 'Provider Name')).toEqual(['Claude Code'])
    expect(parts(html, 'Model Name')).toEqual(['Opus 5'])
    expect(currentEffort(html)).toEqual(['high'])
    expect(html).toContain('value="web-app, payments-web"')
    expect(html).toContain('Pairs with Vega.')
    expect(html).toContain('aria-label="Suggest another name"')
    expect(texts(html, 'button-label')).toEqual(['Cancel', 'Save proposal'])
  })
})

describe('NameField', () => {
  it('pairs the name input with the shuffle button', () => {
    const html = renderToStaticMarkup(<NameField value="Lyra" onChange={noop} suggest={async () => 'Nova'} />)

    expect(html).toMatch(/value="Lyra"[\s\S]*aria-label="Suggest another name"/)
  })
})
