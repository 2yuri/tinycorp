// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import type { McpFoundGroup, McpSource } from '../../../shared/catalogue/mcp-sources'

/**
 * Found on this machine (T242, frame `mPqN9`).
 *
 * The card is handed names and sends back a name. There is no value anywhere in it — a secret
 * goes from the main process to the OS store without this screen holding one — so what these
 * tests watch is that a row says what a server *takes* without saying what it is set to, that a
 * row TinyCorp cannot add says why instead of offering a button, and that a row already in the
 * catalogue says so.
 */

const GROUPS: McpFoundGroup[] = [
  {
    source: 'claude-code',
    path: '/Users/boss/.claude.json',
    servers: [
      {
        name: 'github',
        transport: 'stdio',
        target: 'npx -y @modelcontextprotocol/server-github',
        secretNames: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
        hasToken: false,
        added: false,
        problem: null,
      },
      {
        name: 'linear',
        transport: 'http',
        target: 'https://mcp.linear.app/mcp',
        secretNames: [],
        hasToken: true,
        added: false,
        problem: null,
      },
      {
        name: 'stripe',
        transport: 'http',
        target: 'https://mcp.stripe.com',
        secretNames: [],
        hasToken: true,
        added: true,
        problem: null,
      },
    ],
  },
  {
    source: 'cursor',
    path: '/Users/boss/.cursor/mcp.json',
    servers: [
      {
        name: 'old',
        transport: 'stdio',
        target: 'https://example.com/sse',
        secretNames: [],
        hasToken: false,
        added: false,
        problem: 'sse — TinyCorp carries http and stdio',
      },
    ],
  },
]

const ROW: McpServerRow = {
  id: 'added',
  name: 'github',
  transport: 'stdio',
  url: '',
  command: 'npx',
  args: [],
  env: {},
  secretEnv: '',
  secretNames: [],
  headers: {},
  headerSecretNames: [],
  hasSecret: true,
  employees: 0,
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.assign(window, { tinyCorp: { mcp: {} } })

let host: HTMLElement | null = null
let mounted: Root | null = null
afterEach(() => {
  act(() => mounted?.unmount())
  mounted = null
  host?.remove()
  host = null
})

async function open(groups: McpFoundGroup[] | { error: string } = GROUPS, query = '') {
  const added: [McpSource, string][] = []
  const counts: number[] = []
  const { McpFoundCard } = await import('./McpFound')
  host = document.createElement('div')
  document.body.append(host)
  mounted = createRoot(host)
  await act(async () => {
    mounted?.render(
      <McpFoundCard
        query={query}
        onCount={(total) => counts.push(total)}
        found={() =>
          Promise.resolve('error' in groups ? { ok: false as const, error: groups.error } : { ok: true, value: groups })
        }
        addFound={(source, name) => {
          added.push([source, name])
          return Promise.resolve({ ok: true as const, value: ROW })
        }}
      />,
    )
  })
  return { added, counts }
}

const text = () => host?.textContent ?? ''
const buttons = () => [...(host?.querySelectorAll('button') ?? [])]
const rows = () => [...(host?.querySelectorAll('[data-ui="Found server"]') ?? [])]

describe('Found on this machine', () => {
  it('groups the servers under the tool each was read from, and says where that file is', async () => {
    await open()

    expect(text()).toContain('Claude Code')
    expect(text()).toContain('Cursor')
    expect(text()).toContain('~/.claude.json')
    expect(rows()).toHaveLength(4)
  })

  it('names the variables a server takes, without saying what any of them is set to', async () => {
    await open()

    expect(text()).toContain('GITHUB_PERSONAL_ACCESS_TOKEN → the keychain')
    expect(text()).toContain('bearer token → the keychain')
  })

  it('adds one server on one click, and says nothing back but its name and where it came from', async () => {
    const { added } = await open()
    const add = buttons().find((button) => button.getAttribute('aria-label') === 'Add github')

    await act(async () => add?.click())

    expect(added).toEqual([['claude-code', 'github']])
  })

  it('says a row is already in the catalogue rather than offering to add it again', async () => {
    await open()

    expect(text()).toContain('Added')
    expect(buttons().some((button) => button.getAttribute('aria-label') === 'Add stripe')).toBe(false)
  })

  it('marks a row it has just added, so the boss is not offered it twice', async () => {
    await open()
    const add = buttons().find((button) => button.getAttribute('aria-label') === 'Add github')

    await act(async () => add?.click())

    expect(buttons().some((button) => button.getAttribute('aria-label') === 'Add github')).toBe(false)
  })

  it('says why a server cannot come across, and offers no button for it', async () => {
    await open()

    expect(text()).toContain('sse — TinyCorp carries http and stdio')
    expect(buttons().some((button) => button.getAttribute('aria-label') === 'Add old')).toBe(false)
  })

  it('leaves out the groups the search has emptied, and keeps the rows that match', async () => {
    await open(GROUPS, 'github')

    expect(rows()).toHaveLength(1)
    expect(text()).not.toContain('Cursor')
  })

  it('tells the tab how many were found, which is the whole scan and not what is left', async () => {
    const { counts } = await open(GROUPS, 'github')

    expect(counts.at(-1)).toBe(4)
  })

  it('says so when no tool on this machine holds a server, rather than an empty card', async () => {
    await open([])

    expect(text()).toContain('Nothing found')
  })

  it('shows the reason when the scan itself failed', async () => {
    await open({ error: 'Could not read that' })

    expect(text()).toContain('Could not read that')
  })
})
