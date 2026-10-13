// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpImportPreview } from '../../../shared/catalogue/mcp-import'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'

/**
 * Import from Claude Code (T235, frame `qSIIY`).
 *
 * The dialog is handed names and sends back names. There is no value anywhere in it — the ticket's
 * rule is that a secret goes from the main process to the OS store without this screen holding
 * one — so what these tests watch is that the list says what a server *takes* without saying what
 * it is set to, and that a row TinyCorp cannot import says why instead of quietly coming across.
 */

const PREVIEW: McpImportPreview = {
  source: 'claude',
  path: '/Users/boss/.claude.json',
  servers: [
    {
      name: 'pencil',
      transport: 'stdio',
      target: '/Applications/Pen.app/Contents/Resources/mcp-server --app desktop',
      secretNames: [],
      hasToken: false,
      chosen: true,
      problem: null,
    },
    {
      name: 'github',
      transport: 'stdio',
      target: 'npx -y @modelcontextprotocol/server-github',
      secretNames: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
      hasToken: false,
      chosen: true,
      problem: null,
    },
    {
      name: 'linear',
      transport: 'http',
      target: 'https://mcp.linear.app/mcp',
      secretNames: [],
      hasToken: true,
      chosen: true,
      problem: null,
    },
    {
      name: 'clickup',
      transport: 'http',
      target: 'https://mcp.clickup.com/mcp',
      secretNames: [],
      hasToken: false,
      chosen: false,
      problem: 'already in the catalogue',
    },
  ],
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.assign(window, { tinyCorp: { mcp: {} } })

let host: HTMLElement | null = null
let mounted: Root | null = null
afterEach(() => {
  // The dialog is a portal onto `document.body` (T218): a root left mounted stays on the screen.
  act(() => mounted?.unmount())
  mounted = null
  host?.remove()
  host = null
})

async function open(preview: McpImportPreview | { error: string } = PREVIEW) {
  const imported: string[][] = []
  const { McpImportDialog } = await import('./IntegrationsTab')
  host = document.createElement('div')
  document.body.append(host)
  mounted = createRoot(host)
  let closed = false
  await act(async () => {
    mounted?.render(
      <McpImportDialog
        provider="claude"
        onClose={() => {
          closed = true
        }}
        scan={() =>
          Promise.resolve(
            'error' in preview ? { ok: false as const, error: preview.error } : { ok: true, value: preview },
          )
        }
        importServers={(_provider, names) => {
          imported.push(names)
          return Promise.resolve({ ok: true as const, value: [] as McpServerRow[] })
        }}
      />,
    )
  })
  return { imported, closed: () => closed }
}

/** Every button on the screen: the dialog is a portal, so the host alone would find none of them. */
function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')]
}

function press(label: string) {
  const button = buttons().find((candidate) => candidate.textContent?.includes(label))
  if (!button)
    throw new Error(
      `No button says ${label}. There is: ${buttons()
        .map((b) => b.textContent)
        .join(' | ')}`,
    )
  act(() => button.click())
}

function tick(name: string) {
  const box = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
  if (!box) throw new Error(`No checkbox for ${name}`)
  act(() => box.click())
}

describe('Import from Claude Code', () => {
  it('lists every server with its transport and where it is reached, and where it read them', async () => {
    await open()

    const text = document.body.textContent ?? ''
    expect(text).toContain('~/.claude.json')
    expect(text).toContain('4 servers')
    expect(text).toContain('npx -y @modelcontextprotocol/server-github')
    expect(text).toContain('https://mcp.linear.app/mcp')
  })

  /** The one rule of this dialog: an environment variable is named, never valued. */
  it('names the variables a server takes and promises where their values go', async () => {
    await open()

    const text = document.body.textContent ?? ''
    expect(text).toContain('GITHUB_PERSONAL_ACCESS_TOKEN → the keychain')
    expect(text).toContain('bearer token → the keychain')
    expect(text).toMatch(/never into the Company database/)
  })

  it('ticks what can come across, and refuses a row TinyCorp has no way to import', async () => {
    await open()

    for (const name of ['pencil', 'github', 'linear']) {
      expect(document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)?.checked).toBe(true)
    }
    const clickup = document.querySelector<HTMLInputElement>('input[aria-label="clickup"]')
    expect(clickup?.checked).toBe(false)
    expect(clickup?.disabled).toBe(true)
    expect(document.body.textContent).toContain('already in the catalogue')
  })

  it('sends the names that are ticked, and only those', async () => {
    const { imported, closed } = await open()

    tick('github')
    await act(async () => press('Import 2 servers'))

    expect(imported).toEqual([['pencil', 'linear']])
    expect(closed()).toBe(true)
  })

  it('counts what is ticked on the button, and offers nothing to press with nothing ticked', async () => {
    await open()
    expect(buttons().some((button) => button.textContent?.includes('Import 3 servers'))).toBe(true)

    for (const name of ['pencil', 'github', 'linear']) tick(name)

    const importButton = buttons().find((button) => button.textContent?.trim() === 'Import')
    expect(importButton?.disabled).toBe(true)
  })

  it('says there is nothing to import rather than drawing an empty list', async () => {
    await open({ ...PREVIEW, servers: [] })

    expect(document.body.textContent).toContain('no MCP servers in your own Claude Code config')
  })

  it('shows what went wrong when the config could not be read at all', async () => {
    await open({ error: 'No Company is open' })

    expect(document.body.textContent).toContain('No Company is open')
  })
})
