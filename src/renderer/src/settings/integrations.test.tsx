import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { type McpServerRow, secretLine } from '../../../shared/catalogue/mcp-servers'
import { blankDraft, draftOf, draftProblems, mcpInput, parseEnv, secretHelper, splitCommand } from './mcp-form-model'

/**
 * Company settings → Integrations (T136, frame `uApL8`): the row the catalogue draws, and the form
 * that adds one. The secret is the thing under test everywhere — it is write-only, so no control
 * here may ever be filled from a stored one.
 */

const linear: McpServerRow = {
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
}

const playwright: McpServerRow = {
  id: 's2',
  name: 'playwright',
  transport: 'stdio',
  url: '',
  command: 'npx',
  args: ['@playwright/mcp@latest'],
  env: { PLAYWRIGHT_BROWSER: 'chromium' },
  secretEnv: 'PLAYWRIGHT_TOKEN',
  secretNames: [],
  headers: {},
  headerSecretNames: [],
  hasSecret: false,
  employees: 2,
}

let McpServerForm: typeof import('./IntegrationsTab').McpServerForm

beforeAll(async () => {
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { mcp: {} } }
  ;({ McpServerForm } = await import('./IntegrationsTab'))
})

function form(server: McpServerRow | null, servers: McpServerRow[] = []) {
  return renderToStaticMarkup(<McpServerForm server={server} servers={servers} onSave={() => {}} onCancel={() => {}} />)
}

describe('The Add MCP server form', () => {
  it('says plainly that a stdio server is a command this Mac runs', () => {
    const html = form(playwright)

    expect(html).toContain('This runs a command on your Mac')
    expect(html).toMatch(/command TinyCorp spawns in the Employee/)
    expect(html).toContain('npx @playwright/mcp@latest')
  })

  it('never fills the token box from a server that has one, and says what will happen instead', () => {
    const html = form(linear)

    expect(html).toContain('A token is in the macOS keychain')
    expect(html).toContain('Forget the stored token')
    // Its value is unreadable by construction; the box opens empty over the placeholder.
    expect(html).toMatch(/type="password"[^>]*value=""/)
  })

  it('offers an empty token box on a new server, and says where it goes', () => {
    const html = form(null)

    expect(html).toContain('macOS keychain')
    expect(html).not.toContain('A token is in the keychain')
  })
})

describe('The MCP server draft', () => {
  it('sends no secret at all while the boss has not touched the box', () => {
    expect(mcpInput(draftOf(linear))).not.toHaveProperty('secret')
  })

  it('sends null to forget the stored token once the boss asks for it', () => {
    expect(mcpInput({ ...draftOf(linear), keepSecret: false })).toMatchObject({ secret: null })
  })

  it('splits the command line into a command and its arguments, quotes included', () => {
    expect(splitCommand('npx -y "my server" @scope/mcp@1')).toEqual(['npx', '-y', 'my server', '@scope/mcp@1'])
    expect(mcpInput({ ...blankDraft(), transport: 'stdio', command: 'npx @playwright/mcp@latest' })).toMatchObject({
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    })
  })

  it('reads the environment as NAME=value per line, ignoring blanks and comments', () => {
    expect(parseEnv('A=1\n\n# a note\nB = two words \nnot-a-var\nC=')).toEqual({ A: '1', B: 'two words', C: '' })
  })

  it('refuses a name the Company already has, in the same words as the engine', () => {
    const clash = { ...blankDraft(), name: 'linear', url: 'https://x.example.com/mcp' }

    expect(draftProblems(clash, [linear]).name).toMatch(/already has a server named linear/i)
    // Editing that same server is not a clash with itself.
    expect(draftProblems(clash, [linear], linear.id).name).toBeUndefined()
  })

  it('refuses an http server with no URL and a stdio server with no command', () => {
    expect(draftProblems({ ...blankDraft(), name: 'a' }, []).url).toMatch(/needs a URL/i)
    expect(draftProblems({ ...blankDraft(), name: 'b', transport: 'stdio' }, []).command).toMatch(/needs a command/i)
  })

  it('tells the boss what the token box will do in each of its three states', () => {
    expect(secretHelper(draftOf(linear), 'darwin')).toMatch(/A token is in the macOS keychain/)
    expect(secretHelper({ ...blankDraft(), secret: 'abc' }, 'darwin')).toMatch(/macOS keychain/)
    expect(secretHelper(blankDraft(), 'darwin')).toMatch(/Optional/)
  })

  /**
   * The box named the macOS keychain on every platform (T177). On a Linux desktop the store is
   * the session keyring, and on a desktop with none the token is refused outright — a screen that
   * promises a keychain there is the app describing a lock the machine does not have.
   */
  it('names the store the machine really has, never a keychain that is not there', () => {
    expect(secretHelper(blankDraft(), 'linux')).toMatch(/desktop’s keyring/)
    expect(secretHelper(blankDraft(), 'linux')).not.toMatch(/keychain/)
    expect(secretHelper(blankDraft(), 'win32')).not.toMatch(/keychain/)
    const one = { hasSecret: true, secretNames: [], headerSecretNames: [] }
    expect(secretLine(one, 'linux')).toBe('Token in the keyring')
    expect(secretLine(one, 'darwin')).toBe('Token in the keychain')
    expect(secretLine({ ...one, hasSecret: false }, 'linux')).toBe('No secret')
    // A header-authenticated server keeps a value per header (T245), and the line counts them.
    expect(
      secretLine({ hasSecret: false, secretNames: [], headerSecretNames: ['DD_API_KEY', 'DD_APPLICATION_KEY'] }),
    ).toBe('2 values in the keychain')
  })
})
