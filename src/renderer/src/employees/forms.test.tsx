import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { SkillRow } from '../../../shared/catalogue/skills'
import type { RoleTemplate } from '../../../shared/domain/staff'
import { RoleForm } from './forms'

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

const SKILLS: SkillRow[] = [
  { id: 'sk1', name: 'review-checklist', path: '/Users/boss/skills/review-checklist', missing: false, employees: 4 },
  { id: 'sk2', name: 'pen-handoff', path: '/Users/boss/skills/pen-handoff', missing: true, employees: 1 },
]

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
    name: 'playwright',
    transport: 'stdio',
    url: '',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    env: {},
    secretEnv: '',
    secretNames: [],
    headers: {},
    headerSecretNames: [],
    hasSecret: false,
    employees: 0,
  },
]

describe('RoleForm', () => {
  it('says every Employee on the role follows its fields', () => {
    const html = renderToStaticMarkup(
      <RoleForm title="Edit Frontend" role={frontend} error={null} onSave={noop} onCancel={noop} />,
    )

    expect(html).toContain('Every Employee on this role follows these fields unless they override them')
  })
})

describe('The MCP grant chips a role hands out (T136)', () => {
  it('hands a role its own servers, so everyone hired into it gets them', () => {
    const html = renderToStaticMarkup(
      <RoleForm
        title="Edit Frontend"
        role={{ ...frontend, mcpServers: ['s2'] }}
        servers={SERVERS}
        error={null}
        onSave={noop}
        onCancel={noop}
      />,
    )

    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*>.*?playwright/s)
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>.*?linear/s)
  })
})

describe('The skill grant chips a role hands out (T137)', () => {
  it('hands a role its own skills, so everyone hired into it gets them', () => {
    const html = renderToStaticMarkup(
      <RoleForm
        title="Edit Frontend"
        role={{ ...frontend, skills: ['sk2'] }}
        skills={SKILLS}
        error={null}
        onSave={noop}
        onCancel={noop}
      />,
    )

    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*>.*?pen-handoff/s)
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>.*?review-checklist/s)
  })
})
