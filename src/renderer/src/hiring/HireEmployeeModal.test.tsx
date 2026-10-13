import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../shared/catalogue/skills'
import { PROVIDER_LABEL, PROVIDERS, type Provider } from '../../../shared/domain/providers'
import type { Employee, EmployeeInput, RoleTemplate } from '../../../shared/domain/staff'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import type { PreflightState, ProviderPreflight } from '../../../shared/providers/preflight'
import { FALLBACK_PROVIDER } from '../../../shared/staff/models'
import { cx } from '../ui'
import { draftForRole, type HireDraft, hireInput, stepLook } from './hire-model'

// Static rendering has no DOM: portals render in place.
vi.mock('react-dom', async (original) => ({
  ...(await original<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}))

let HireEmployeeModal: typeof import('./HireEmployeeModal').HireEmployeeModal

beforeAll(async () => {
  const globals = globalThis as { document?: unknown }
  globals.document = { body: {} }
  ;({ HireEmployeeModal } = await import('./HireEmployeeModal'))
})

const roles: RoleTemplate[] = [
  {
    id: 'pm',
    name: 'PM',
    persona: 'You are the project manager.',
    capabilities: ['intake'],
    repoFilter: [],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
  {
    id: 'frontend',
    name: 'Frontend',
    persona: 'You build the screens users touch.',
    capabilities: ['code'],
    repoFilter: ['*web*'],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
]

const vega: Employee = {
  id: 'e1',
  name: 'Vega',
  roleId: 'frontend',
  title: 'Frontend',
  persona: '',
  capabilities: ['code'],
  repoFilter: ['*'],
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

const SERVERS: McpServerRow[] = [
  {
    id: 's1',
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: true,
    employees: 4,
  },
  {
    id: 's2',
    name: 'sentry',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: true,
    employees: 1,
  },
]

const noop = () => {}

/**
 * What one part of the modal says, by the `data-ui` name it carries. The assertions used to name the
 * class each part was drawn with; the modal is drawn from utilities now (T210f), and a class list is
 * not what any of these tests was ever about.
 */
const parts = (html: string, ui: string) =>
  [...html.matchAll(new RegExp(`data-ui="${ui}"[^>]*>([^<]*)<`, 'g'))].map((match) => match[1] ?? '')
const part = (html: string, ui: string) => parts(html, ui)[0] ?? null

const SKILLS: SkillRow[] = [
  { id: 'sk1', name: 'review-checklist', path: '/Users/boss/skills/review-checklist', missing: false, employees: 4 },
  { id: 'sk2', name: 'pen-handoff', path: '/Users/boss/skills/pen-handoff', missing: true, employees: 1 },
]

function render(over: Partial<Parameters<typeof HireEmployeeModal>[0]> = {}) {
  return renderToStaticMarkup(
    <HireEmployeeModal
      companyName="Tiny Corp"
      roles={roles}
      employees={[vega]}
      former={[]}
      repoNames={['payments-web', 'web-app', 'billing-api']}
      headcount={{ current: 6, max: 12 }}
      error={null}
      suggestName={async () => 'Lyra'}
      onCancel={noop}
      onHire={noop}
      {...over}
    />,
  )
}

describe('the Hire Employee modal', () => {
  it('is the design’s 660px dialog, not a side panel', () => {
    const html = render()

    expect(html).toContain('data-ui="Modal Overlay"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).not.toContain('emp-panel')
  })

  it('heads the modal with the Company and the seat the hire takes', () => {
    expect(part(render(), 'Modal Subtitle')).toBe('Tiny Corp · seat 7 of 12')
  })

  it('offers the catalog as a chip grid, the first role chosen', () => {
    const html = render()

    expect(parts(html, 'Role Label')).toEqual(['PM', 'Frontend'])
    // The picked tile takes the primary stroke and wash, and it is the one with the radio checked.
    expect(html).toMatch(/data-ui="Role"[^>]*border-primary[^>]*><input type="radio"[^>]*checked=""/)
    // The role chips, then the PERMISSIONS pair, which is its own radio group.
    expect([...html.matchAll(/<input type="radio"[^>]*?( checked="")?\/>/g)].map(([, on]) => on !== undefined)).toEqual(
      [true, false, true, false],
    )
  })

  it('opens on the character the office would hand out next', () => {
    // Sheets 0 and 1 are taken; 2 is the least used.
    const html = render({ employees: [vega, { ...vega, id: 'e2', name: 'Nova', sprite: 1 }] })

    // Sheets 0 and 1 are taken, so the modal opens on 2; past LOOK_DOTS_FIT characters the row of
    // dots gives way to a count, so the marked one is what this asserts.
    expect(html).toContain('data-ui="Look Count"')
    expect(html).toContain('3 / ' + CHARACTER_SHEETS)
  })

  it('shows the chosen look on a floor, with an arrow each way and which character it is', () => {
    const html = render({ initialSprite: 3 })

    expect(html).toContain('data-ui="Look Floor"')
    expect(html).toContain('aria-label="Previous character"')
    expect(html).toContain('aria-label="Next character"')
    expect(html).toContain('4 / ' + CHARACTER_SHEETS)
  })

  it('opens the role’s repos as chips, each with a way out, plus Add repository', () => {
    // The PERMISSIONS pair are chips too, and they come first; the repos are what follows them.
    const repoChips = (html: string) => parts(html, 'Chip Label').slice(2)
    const html = render()

    expect(repoChips(html)).toEqual(['Add repository'])

    const frontendFirst = render({ roles: [roles[1]!, roles[0]!] })
    expect(repoChips(frontendFirst)).toEqual(['payments-web', 'web-app', 'Add repository'])
    expect(frontendFirst).toContain('aria-label="Remove payments-web"')
  })

  it('opens PERMISSIONS on the Company’s default, whichever way it is set (T164)', () => {
    const checked = (html: string) =>
      [
        ...html.matchAll(
          /data-ui="Chip"[^>]*><input type="radio"[^>]*?( checked="")?\/>(?:<svg[^>]*>.*?)?data-ui="Chip Label"[^>]*>([^<]*)</gs,
        ),
      ]
        .filter(([, on]) => on !== undefined)
        .map(([, , label]) => label)

    expect(checked(render({ permissionDefault: 'interactive' }))).toEqual(['Ask first'])
    expect(checked(render({ permissionDefault: 'skip-permissions' }))).toEqual(['Run without asking'])
  })

  it('shows the app’s own default until the Company has answered, rather than an empty field', () => {
    const html = render({ permissionDefault: null })

    expect(html).toMatch(/data-ui="Chip"[^>]*border-primary[^>]*><input type="radio"[^>]*checked=""/)
    expect(html).toContain('From the Company’s default. Change it here for this hire.')
  })

  it('says in the footer what hiring does, and names the Hire button after nobody until the name lands', () => {
    const html = render()

    // Static rendering never runs the effect that asks the generator for a name.
    expect(html).toContain('They walks in, takes desk 2 and says hello in #general.')
    expect(html).toContain('>Hire</button>')
    expect(html).toContain('>Cancel</button>')
  })
})

describe('choosing a look', () => {
  const draft: HireDraft = {
    roleId: 'frontend',
    name: 'Lyra',
    permissionMode: null,
    provider: 'claude',
    model: null,
    persona: '',
    repoFilter: ['*web*'],
    areas: [],
    mcpServers: [],
    skills: [],
    sprite: 0,
  }

  it('walks the sheets both ways, wrapping at each end', () => {
    const back = { ...draft, sprite: stepLook(draft.sprite, -1, CHARACTER_SHEETS) }
    const forward = { ...back, sprite: stepLook(back.sprite, 1, CHARACTER_SHEETS) }

    expect(back.sprite).toBe(CHARACTER_SHEETS - 1)
    expect(forward.sprite).toBe(0)
  })

  it('sends the chosen sheet to the hire, so the same character walks into the office', () => {
    const chosen = { ...draft, sprite: stepLook(draft.sprite, 4, CHARACTER_SHEETS) }
    const sent: EmployeeInput = hireInput(chosen)

    expect(sent.sprite).toBe(4)
    expect(sent).toMatchObject({ name: 'Lyra', roleId: 'frontend', repoFilter: ['*web*'] })
  })
})

describe('the LOOK control with many characters', () => {
  it('keeps one dot per character while they fit, and counts them past that', () => {
    const source = readFileSync(join(import.meta.dirname, 'LookField.tsx'), 'utf8')
    expect(source).toContain('export const LOOK_DOTS_FIT = 8')
    expect(source).toContain('CHARACTER_SHEETS <= LOOK_DOTS_FIT')
    expect(source).toContain('data-ui="Look Count"')
  })
})

describe('the hire’s MCP servers (T136)', () => {
  it('opens on the role’s own servers, as chips the boss can turn off', () => {
    const withGrant: RoleTemplate[] = [{ ...roles[0]!, mcpServers: ['s1'] }, roles[1]!]
    const html = render({ roles: withGrant, servers: SERVERS })

    expect(html).toContain('MCP SERVERS')
    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*>.*?linear/s)
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>.*?sentry/s)
  })

  it('draws no MCP row at all in a Company with no catalogue', () => {
    expect(render({ servers: [] })).not.toContain('MCP SERVERS')
  })

  it('hires with exactly the servers the chips show', () => {
    expect(hireInput({ ...draft(), mcpServers: ['s1'] })).toMatchObject({ mcpServers: ['s1'] })
  })
})

describe('the hire’s skills (T137)', () => {
  it('opens on the role’s own skills, as chips the boss can turn off', () => {
    const withGrant: RoleTemplate[] = [{ ...roles[0]!, skills: ['sk1'] }, roles[1]!]
    const html = render({ roles: withGrant, skills: SKILLS })

    expect(html).toContain('SKILLS')
    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*>.*?review-checklist/s)
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>.*?pen-handoff/s)
  })

  it('says on the chip when a folder is not where the boss left it', () => {
    expect(render({ skills: SKILLS })).toContain('Folder is missing')
  })

  it('draws no skills row at all in a Company with no catalogue', () => {
    expect(render({ skills: [] })).not.toContain('SKILLS')
  })

  it('hires with exactly the skills the chips show', () => {
    expect(hireInput({ ...draft(), skills: ['sk1'] })).toMatchObject({ skills: ['sk1'] })
  })
})

/**
 * Any one Provider is enough (T169): the modal opens on whichever product this Mac can run, not on
 * the catalogue's first. Nothing here spawns a CLI — the answers arrive as the props the main
 * process already read.
 */
describe('the Provider a hire starts on', () => {
  /** Every Provider's answer, as the preflight hands them over; unnamed ones are not installed. */
  const machine = (states: Partial<Record<Provider, PreflightState>>): ProviderPreflight[] =>
    PROVIDERS.map((provider) => ({
      provider,
      state: states[provider] ?? 'missing',
      title: '',
      body: '',
      lead: '',
      commands: [],
      note: '',
      account: null,
      plan: null,
      checkedAt: '2026-09-22T09:00:00.000Z',
      hired: false,
    }))

  /** The Provider the MODEL field opens on: its chip carries the product's own name. */
  const openedOn = (preflight: ProviderPreflight[]) => {
    const html = render({ preflight })
    return PROVIDERS.filter((provider) => html.includes(`>${PROVIDER_LABEL[provider]}<`))
  }

  it('opens on the only Provider the Mac can run, whichever one that is', () => {
    for (const provider of PROVIDERS) {
      expect(openedOn(machine({ [provider]: 'ready' })), provider).toEqual([provider])
    }
  })

  it('opens on the first ready one when several are, in catalogue order', () => {
    const [first, second] = PROVIDERS as [Provider, Provider, ...Provider[]]

    expect(openedOn(machine({ [first]: 'ready', [second]: 'ready' }))).toEqual([first])
    expect(openedOn(machine({ [second]: 'ready' }))).toEqual([second])
  })

  it('starts with no model, so the hire runs on that product’s own default (decision 31)', () => {
    const last = PROVIDERS.at(-1)!

    expect(draftForRole(roles[0], { name: '', model: null, sprite: 0 }, last)).toMatchObject({
      provider: last,
      model: null,
    })
  })
})

/** The draft the hire button sends, as the modal holds it. */
function draft(): HireDraft {
  return {
    roleId: 'frontend',
    name: 'Lyra',
    permissionMode: null,
    model: null,
    provider: FALLBACK_PROVIDER,
    persona: '',
    repoFilter: [],
    areas: [],
    mcpServers: [],
    skills: [],
    sprite: 0,
  }
}

/**
 * T239: a hire whose filter matches none of the Company's repos will pick up nothing, and the modal
 * used to take it without a word. A PM works in no repo by design and is not shut out of anything.
 */
describe('the hire flow warns when the filter matches no repo', () => {
  const warned = (html: string) => html.includes('can’t work in any of this Company’s repos')

  it('warns for an engineer no repo matches, and says nothing when one does', () => {
    const shut = render({ roles: [{ ...roles[1]!, repoFilter: ['*mobile*'] }] })

    expect(warned(shut)).toBe(true)
    expect(shut).toContain('Allow all repos')
    expect(warned(render({ roles: [roles[1]!] }))).toBe(false)
  })

  it('says nothing about a role that works in no repo by design', () => {
    expect(warned(render({ roles: [roles[0]!] }))).toBe(false)
  })
})

/**
 * The modal scrolled sideways (T224). `LookField` wrote `` `${FIELD} ${LOOK}` `` — `w-full` and
 * `w-132` on one element — and Tailwind's emission order, not the author, decided it: `w-full` won,
 * so the LOOK column took the whole row, NAME and MODEL were pushed past the modal's right edge,
 * and focusing NAME on open scrolled the body 149px sideways to reach them.
 *
 * jsdom lays nothing out, so the overflow itself is asserted in a real window by
 * `e2e/hire-employee.spec.ts`, with a long name and a long model name in the fields. What is
 * asserted here is the cause, and on every element rather than on that one: `cx` is
 * `tailwind-merge`, so a class list it would shorten is a class list with two utilities of one
 * group on it, and which of them draws is a pixel nobody chose.
 */
describe('nothing in the modal is left for Tailwind’s sort order to decide (T224)', () => {
  it('draws no element carrying two utilities of the same group', () => {
    const fighting = [...render().matchAll(/class="([^"]*)"/g)]
      .map(([, list]) => list ?? '')
      .filter((list) => cx(list) !== list)
      .map((list) => `${list}  →  ${cx(list)}`)

    expect(fighting).toEqual([])
  })
})

describe('the New role chip', () => {
  it('is drawn after the roles, and only when it has somewhere to go (T240)', () => {
    const shown = parts(render(), 'Role Label')

    expect(shown).not.toContain('New role…')
    expect(parts(render({ onNewRole: noop }), 'Role Label')).toEqual([...shown, 'New role…'])
  })
})
