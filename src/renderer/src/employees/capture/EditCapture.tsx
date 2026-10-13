// The frame's own Employee (`FbR2n`), as engine data: Ada Lorne, Frontend, hired 12 Sep, desk 4,
// with linear from her role and playwright her own. Nothing here ships.
import { useEffect, useState } from 'react'
import type { McpServerRow } from '../../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../../shared/catalogue/skills'
import { PROVIDER_CATALOGUE } from '../../../../shared/domain/providers'
import type { Employee, EmployeePatch, RoleTemplate } from '../../../../shared/domain/staff'
import type { ProviderPreflight } from '../../../../shared/providers/preflight'
import { EditEmployeeModal } from '../EditEmployeeModal'

export const roles: RoleTemplate[] = [
  {
    id: 'pm',
    name: 'PM',
    persona: '',
    capabilities: ['intake', 'plan', 'hire'],
    repoFilter: [],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
  {
    id: 'tech-lead',
    name: 'Tech Lead',
    persona: '',
    capabilities: ['plan', 'code', 'review'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
  {
    id: 'frontend',
    name: 'Frontend',
    persona: 'You are a frontend engineer. You build the screens users touch.',
    capabilities: ['code', 'review'],
    repoFilter: ['payments-web', 'web-app'],
    areas: [],
    mcpServers: ['linear'],
    skills: ['review-checklist'],
    seeded: true,
  },
  {
    id: 'backend',
    name: 'Backend',
    persona: '',
    capabilities: ['code'],
    repoFilter: ['*api*'],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
  {
    id: 'devops',
    name: 'DevOps',
    persona: '',
    capabilities: ['code'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
  {
    id: 'qa',
    name: 'QA',
    persona: '',
    capabilities: ['review', 'code'],
    repoFilter: ['*'],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
  {
    id: 'hr',
    name: 'HR',
    persona: '',
    capabilities: ['hire'],
    repoFilter: [],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
  {
    id: 'po',
    name: 'PO',
    persona: '',
    capabilities: ['intake', 'plan'],
    repoFilter: [],
    areas: [],
    mcpServers: [],
    skills: [],
    seeded: true,
  },
]

export const ada: Employee = {
  id: 'e-ada',
  name: 'Ada Lorne',
  roleId: 'frontend',
  title: 'Frontend',
  persona:
    'Pairs with Vega on the component layer. Small PRs, tests first, a screenshot on every UI change. Asks in #general before touching billing.',
  capabilities: ['code', 'review'],
  repoFilter: ['payments-web', 'web-app'],
  areas: [],
  // linear comes from the Frontend role; playwright is hers, so the line under the row says so.
  mcpServers: ['linear', 'playwright'],
  // review-checklist comes from the Frontend role; the frame draws deploy-runbook off beside it.
  skills: ['review-checklist'],
  provider: 'claude',
  permissionMode: 'skip-permissions',
  model: 'opus-5-balanced',
  overrides: ['persona', 'mcpServers'],
  desk: 3,
  sprite: 0,
  createdAt: '2026-09-12T09:00:00',
}

function server(id: string, name: string): McpServerRow {
  return {
    id,
    name,
    transport: 'http',
    url: `https://mcp.${name}.app/mcp`,
    command: '',
    args: [],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: true,
    employees: 1,
  }
}

export const servers: McpServerRow[] = [
  server('linear', 'linear'),
  server('playwright', 'playwright'),
  server('sentry', 'sentry'),
]

/** The frame's own SKILLS row: review-checklist on, deploy-runbook off. */
export const skills: SkillRow[] = [
  {
    id: 'review-checklist',
    name: 'review-checklist',
    path: '/Users/ada/skills/review-checklist',
    missing: false,
    employees: 2,
  },
  {
    id: 'deploy-runbook',
    name: 'deploy-runbook',
    path: '/Users/ada/skills/deploy-runbook',
    missing: false,
    employees: 0,
  },
]

/** Every Provider signed in, so the model field is in the state the frame draws it in. */
export const preflight: ProviderPreflight[] = PROVIDER_CATALOGUE.map((entry) => ({
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

/**
 * The modal, live. `?role=<name>` presses that role chip the way the boss does, so the capture can
 * show what a role change moves and what it leaves alone; `?scroll=end` scrolls the body to its end.
 */
export function EditCapture() {
  const [employee] = useState(ada)
  const [saved, setSaved] = useState<EmployeePatch | null>(null)
  const query = new URLSearchParams(location.search)
  const pick = query.get('role')
  const toEnd = query.get('scroll') === 'end'

  // biome-ignore lint/correctness/useExhaustiveDependencies: the capture presses the chip the query names once, on mount, and never again.
  useEffect(() => {
    const chips = [...document.querySelectorAll<HTMLButtonElement>('.hire-role')]
    if (pick) chips.find((chip) => chip.textContent === pick)?.click()
    // The role change re-renders first; the scroll waits a tick so it measures the body it lands on.
    const scroll = setTimeout(() => {
      const body = document.querySelector('.hire-form')
      if (toEnd && body) body.scrollTop = body.scrollHeight
    })
    return () => clearTimeout(scroll)
  }, [])

  return (
    <>
      <EditEmployeeModal
        companyName="Tiny Corp"
        employee={employee}
        roles={roles}
        employees={[employee]}
        repoNames={['payments-web', 'web-app', 'billing-api', 'infra']}
        servers={servers}
        skills={skills}
        error={null}
        preflight={preflight}
        onCancel={() => setSaved(null)}
        onSave={setSaved}
      />
      {saved && <pre hidden>{JSON.stringify(saved)}</pre>}
    </>
  )
}
