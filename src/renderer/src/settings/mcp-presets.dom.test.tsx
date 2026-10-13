// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { MCP_PRESETS } from '../../../shared/catalogue/mcp-presets'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'

/**
 * Popular, and the dialog that sets one up (T242, frames `mPqN9`, `gue8i`).
 *
 * The one thing the dialog does that nothing else on this tab does is take a value: the boss
 * types a token in and it goes over IPC once. So these tests watch that it is typed into a
 * password box, that it is sent exactly once and under the key the preset named, and that nothing
 * on this screen ever gets to read it back — the field starts empty again every time it opens.
 */

const ROW: McpServerRow = {
  id: 'added',
  name: 'github',
  transport: 'http',
  url: 'https://api.githubcopilot.com/mcp/',
  command: '',
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
  // The dialog is a portal onto `document.body` (T218): a root left mounted stays on the screen.
  act(() => mounted?.unmount())
  mounted = null
  host?.remove()
  host = null
})

type Sent = { presetId: string; name: string; values: Record<string, string> }

async function gallery(query = '', taken: string[] = []) {
  const sent: Sent[] = []
  const { McpPresetsCard } = await import('./McpPresets')
  host = document.createElement('div')
  document.body.append(host)
  mounted = createRoot(host)
  await act(async () => {
    mounted?.render(
      <McpPresetsCard
        query={query}
        taken={taken}
        addPreset={(presetId, name, values) => {
          sent.push({ presetId, name, values })
          return Promise.resolve({ ok: true as const, value: ROW })
        }}
      />,
    )
  })
  return { sent }
}

const text = () => document.body.textContent ?? ''
const tiles = () => [...(host?.querySelectorAll('[data-ui="Preset"]') ?? [])] as HTMLButtonElement[]
const dialog = () => document.querySelector('[role="dialog"]')
const fields = () => [...(dialog()?.querySelectorAll('input') ?? [])]
const selects = () => [...(dialog()?.querySelectorAll('select') ?? [])]
const links = () => [...(dialog()?.querySelectorAll('a') ?? [])].map((link) => link.getAttribute('href'))
const submit = () => dialog()?.querySelector('button[type="submit"]') as HTMLButtonElement | null

/** Types into a controlled React input the way a keystroke does. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function openGithub() {
  const opened = await gallery()
  const tile = tiles().find((button) => button.textContent?.includes('GitHub'))
  await act(async () => tile?.click())
  return opened
}

async function openDatadog() {
  const opened = await gallery('Datadog')
  await act(async () => tiles()[0]?.click())
  return opened
}

/** Picks an option the way the boss does, on a controlled React select. */
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('The preset gallery', () => {
  it('draws one tile per preset, with the service’s own name and what it will ask for', async () => {
    await gallery()

    expect(tiles()).toHaveLength(MCP_PRESETS.length)
    expect(text()).toContain('GitHub')
    expect(text()).toContain('Token')
    expect(text()).toContain('No secret')
  })

  it('narrows to what the search matches, and says so when nothing does', async () => {
    await gallery('browser')

    expect(tiles().map((tile) => tile.textContent)).toHaveLength(1)
    expect(text()).toContain('Playwright')
  })

  it('says so when the search matches no preset at all', async () => {
    await gallery('there is no such thing')

    expect(tiles()).toHaveLength(0)
    expect(text()).toContain('No preset matches that')
  })
})

describe('Setting a preset up', () => {
  it('opens on the preset’s own name, transport and target, all filled in already', async () => {
    await openGithub()

    expect(dialog()?.getAttribute('aria-label')).toBe('Set up GitHub')
    expect(text()).toContain('https://api.githubcopilot.com/mcp/')
    expect(fields()[0]?.value).toBe('github')
  })

  it('takes the secret in a password box, and links to where the boss gets one', async () => {
    await openGithub()

    expect(fields()[1]?.type).toBe('password')
    const link = dialog()?.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens/new')
    expect(link?.getAttribute('target')).toBe('_blank')
  })

  it('will not add until the secret the server needs is there', async () => {
    await openGithub()

    expect(submit()?.disabled).toBe(true)
    await act(async () => type(fields()[1] as HTMLInputElement, 'ghp_typed_in'))
    expect(submit()?.disabled).toBe(false)
  })

  /**
   * An empty box outlined in red the moment a dialog opens reads as something having gone wrong,
   * when nothing has: the boss simply has not typed yet. The disabled button is what says it.
   */
  it('does not call a field wrong before the boss has been in it', async () => {
    await openGithub()

    expect(text()).not.toContain('GitHub needs personal access token')
    await act(async () => type(fields()[1] as HTMLInputElement, 'x'))
    await act(async () => type(fields()[1] as HTMLInputElement, ''))
    expect(text()).toContain('GitHub needs personal access token')
  })

  it('sends the value once, under the key the preset named, and keeps nothing of it', async () => {
    const { sent } = await openGithub()
    await act(async () => type(fields()[1] as HTMLInputElement, 'ghp_typed_in'))

    await act(async () => submit()?.click())

    expect(sent).toEqual([{ presetId: 'github', name: 'github', values: { token: 'ghp_typed_in' } }])
    // The dialog closed with it, so there is nowhere left holding what was typed.
    expect(dialog()).toBeNull()
  })

  it('opens with an empty box the next time, because nothing ever reads a stored value back', async () => {
    await openGithub()
    await act(async () => type(fields()[1] as HTMLInputElement, 'ghp_typed_in'))
    await act(async () => submit()?.click())

    const tile = tiles().find((button) => button.textContent?.includes('GitHub'))
    await act(async () => tile?.click())

    expect(fields()[1]?.value).toBe('')
  })

  it('refuses a name this Company already has, before anything is sent', async () => {
    await gallery('', ['github'])
    const tile = tiles().find((button) => button.textContent?.includes('GitHub'))

    await act(async () => tile?.click())

    expect(text()).toContain('This Company already has a server named github')
    expect(submit()?.disabled).toBe(true)
  })

  it('says what a preset needs before it will work, when there is something to say', async () => {
    await gallery('browser')
    await act(async () => tiles()[0]?.click())

    expect(text()).toContain('The first run downloads a browser')
  })

  it('adds a preset that asks for nothing as soon as it opens', async () => {
    const { sent } = await gallery('browser')
    await act(async () => tiles()[0]?.click())

    await act(async () => submit()?.click())

    expect(sent).toEqual([{ presetId: 'playwright', name: 'playwright', values: {} }])
  })
})

/**
 * A server that authenticates with named headers (T245). Two things are different here: the site
 * is picked from a list rather than typed, and there is more than one secret — so the dialog has to
 * mask every one of them and send them all under the header names the server reads them from.
 */
describe('Setting up a header-authenticated preset', () => {
  it('opens on a real endpoint, with the site already chosen', async () => {
    await openDatadog()

    expect(selects()[0]?.value).toBe('datadoghq.com')
    expect(text()).toContain('https://mcp.datadoghq.com/v1/mcp')
  })

  it('rewrites the endpoint and both key pages when the boss picks another site', async () => {
    await openDatadog()

    await act(async () => choose(selects()[0] as HTMLSelectElement, 'datadoghq.eu'))

    expect(text()).toContain('https://mcp.datadoghq.eu/v1/mcp')
    expect(links()).toEqual([
      'https://app.datadoghq.eu/organization-settings/api-keys',
      'https://app.datadoghq.eu/organization-settings/application-keys',
    ])
  })

  it('masks every key and sends them under the header names, once', async () => {
    const { sent } = await openDatadog()
    // The name box, then one box per key — the site is a select and is not among them.
    expect(fields().map((field) => field.type)).toEqual(['text', 'password', 'password'])

    await act(async () => type(fields()[1] as HTMLInputElement, 'dd_api_typed_in'))
    expect(submit()?.disabled).toBe(true)
    await act(async () => type(fields()[2] as HTMLInputElement, 'dd_app_typed_in'))
    await act(async () => submit()?.click())

    expect(sent).toEqual([
      {
        presetId: 'datadog',
        name: 'datadog',
        values: { site: 'datadoghq.com', DD_API_KEY: 'dd_api_typed_in', DD_APPLICATION_KEY: 'dd_app_typed_in' },
      },
    ])
  })

  it('takes SigNoz’s instance URL in the open, because it is not a secret', async () => {
    await gallery('SigNoz')
    await act(async () => tiles()[0]?.click())

    expect(fields().map((field) => field.type)).toEqual(['text', 'text', 'password'])
    expect(selects()[0]?.value).toBe('us')
  })
})
