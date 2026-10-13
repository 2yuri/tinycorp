// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROVIDER_CATALOGUE } from '../../../shared/domain/providers'
import type { Employee, RoleTemplate } from '../../../shared/domain/staff'
import type { ProviderPreflight } from '../../../shared/providers/preflight'
import type { HireProposal } from '../employees'
import { EditEmployeeModal, HireProposalPanel, ProposalForm } from '../employees'
import { HireEmployeeModal } from '../hiring'

/**
 * One control, everywhere it is drawn — the same assertion T134 makes of the LOOK control.
 *
 * T139 replaced two `Select`s with one component. The point of one component is that the next
 * change to it reaches every screen that draws it, and the only way to keep that true is to
 * compare the markup the four of them produce, rather than four screens that merely look alike.
 */

const noop = () => {}

const frontend: RoleTemplate = {
  id: 'frontend',
  name: 'Frontend',
  persona: 'You build the screens users touch.',
  capabilities: ['code'],
  repoFilter: ['*web*'],
  areas: [],
  mcpServers: [],
  skills: [],
  seeded: true,
}

/** Every Provider signed in, so the field is in the same state in each of the four. */
const preflight: ProviderPreflight[] = PROVIDER_CATALOGUE.map((entry) => ({
  provider: entry.id,
  state: 'ready',
  title: '',
  body: '',
  lead: '',
  commands: [],
  note: '',
  account: null,
  plan: null,
  checkedAt: '',
  hired: false,
}))

/** A model that is nobody's default: the second Provider's first, so the chip has to be read off it. */
const chosen = PROVIDER_CATALOGUE[1]!

const employee = (model: string | null): Employee => ({
  id: 'e1',
  name: 'Lyra',
  roleId: 'frontend',
  mcpServers: [],
  skills: [],
  title: 'Frontend',
  persona: 'Pairs with Vega.',
  capabilities: ['code'],
  repoFilter: ['*web*'],
  areas: [],
  provider: model === null ? PROVIDER_CATALOGUE[0]!.id : chosen.id,
  permissionMode: 'skip-permissions',
  model,
  overrides: [],
  desk: 0,
  sprite: 0,
  createdAt: '',
})

const proposal = (model: string | null): HireProposal => ({
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
  requester: { name: 'Hera', label: 'HR · hire', person: null },
  candidate: {
    name: 'Lyra',
    person: null,
    named: true,
    roleId: 'frontend',
    roleName: 'Frontend',
    roleLine: 'Frontend · from the role catalog',
    persona: 'Pairs with Vega.',
    capabilities: ['code'],
    repoFilter: ['*web*'],
    provider: chosen.name,
    providerId: employee(model).provider,
    requestId: 3,
    model,
    modelLabel: model ?? 'Default model',
  },
  pendingCount: 1,
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function draw(element: ReactNode) {
  act(() => root.render(element))
}

/**
 * The control as it stands in the document — the modal draws through a portal, so not in `host`.
 *
 * The effort segments are radios, and each picker gets its own group name from `useId` so two open
 * at once do not fight over one group. The name counts up per render, so it is not part of what
 * "the same control" means and is taken out before the comparison.
 */
function control(): string {
  const found = document.querySelector('[data-ui="Model Picker"]')
  if (!found) throw new Error('no model picker')
  return found.outerHTML.replaceAll(/ name="[^"]*"/g, ' name="»"')
}

/**
 * What each screen draws, every one of them holding the same Employee on the same model. The hire
 * modal always opens on the Provider's default, so it joins the comparison only there.
 */
function screens(model: string | null): Record<string, ReactNode> {
  return {
    ...(model === null && {
      'the hire modal': (
        <HireEmployeeModal
          companyName="Tiny Corp"
          roles={[frontend]}
          employees={[]}
          former={[]}
          repoNames={[]}
          headcount={null}
          error={null}
          preflight={preflight}
          suggestName={async () => null}
          onCancel={noop}
          onHire={noop}
        />
      ),
    }),
    'the edit modal': (
      <EditEmployeeModal
        companyName="Tiny Corp"
        employee={employee(model)}
        roles={[frontend]}
        employees={[employee(model)]}
        repoNames={[]}
        error={null}
        preflight={preflight}
        onSave={noop}
        onCancel={noop}
      />
    ),
    'the proposal editor': (
      <ProposalForm
        proposal={{
          name: 'Lyra',
          roleId: 'frontend',
          persona: 'Pairs with Vega.',
          capabilities: ['code'],
          repoFilter: ['*web*'],
          areas: [],
          model,
        }}
        roles={[frontend]}
        error={null}
        preflight={preflight}
        suggestName={async () => null}
        onSave={noop}
        onCancel={noop}
      />
    ),
    'the hire candidate card': (
      <HireProposalPanel
        proposal={proposal(model)}
        channelName="general"
        time="09:48"
        load={null}
        repos={['web-app']}
        autonomy={null}
        effect={null}
        error={null}
        preflight={preflight}
        onApprove={noop}
        onReject={noop}
        onModel={noop}
      />
    ),
  }
}

/** The control each screen draws, screen by screen, with nothing left on the page between them. */
function drawnByEach(model: string | null): [string, string][] {
  return Object.entries(screens(model)).map(([where, screen]) => {
    draw(screen)
    const html = control()
    draw(<></>)
    return [where, html]
  })
}

describe('the model picker', () => {
  it('is the same control in every place a hire starts on the Provider default', () => {
    const drawn = drawnByEach(null)

    expect(drawn.map(([where]) => where)).toHaveLength(4)
    const [first, ...rest] = drawn
    for (const [where, html] of rest) expect(html, where).toBe(first![1])
  })

  it('is the same control in the three places that carry an Employee’s own model', () => {
    const drawn = drawnByEach(chosen.models[0]!.id)

    expect(drawn.map(([where]) => where)).toHaveLength(3)
    const [first, ...rest] = drawn
    for (const [where, html] of rest) expect(html, where).toBe(first![1])
  })

  it('has something to compare: the control it found is the one from the frame', () => {
    draw(screens(chosen.models[0]!.id)['the edit modal']!)

    expect(control()).toContain('>MODEL</span>')
    expect(control()).toContain('data-ui="Provider Name"')
    expect(control()).toContain(chosen.name)
  })
})
