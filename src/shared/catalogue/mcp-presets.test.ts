import { describe, expect, it } from 'vitest'
import { inMachineWords } from '../platform/machine-words'
import {
  MCP_PRESETS,
  type McpPreset,
  presetDefaults,
  presetInput,
  presetLinks,
  presetNeedLine,
  presetProblems,
  presetTarget,
} from './mcp-presets'
import { isMcpHeaderName, MCP_NAME_PATTERN, mcpServerProblems } from './mcp-servers'

/**
 * The preset table (T242).
 *
 * A preset is a claim about somebody else's product that a boss will act on without checking, so
 * the rules below are the ones that stop an entry being a guess: every one says where it was read
 * and when, every one produces something the catalogue will actually take, and no entry can quietly
 * grow a second `http` secret the bearer token has nowhere to put.
 */

const preset = (id: string): McpPreset => {
  const found = MCP_PRESETS.find((entry) => entry.id === id)
  if (!found) throw new Error(`no preset ${id}`)
  return found
}

describe('Every preset', () => {
  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s is a server the catalogue takes',
    (_id, entry) => {
      expect(entry.server).toMatch(MCP_NAME_PATTERN)
      expect(mcpServerProblems({ ...presetInput(entry, entry.server, filled(entry)), secretEnv: '' }, [])).toEqual({})
    },
  )

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s names the machine only through its words, so a PC reads a PC (T265)',
    (_id, entry) => {
      const prose = [entry.summary, entry.caveat ?? '', ...entry.fields.map((field) => field.helper)]
      for (const text of prose) expect(inMachineWords(text, 'win32')).not.toMatch(/[{}]/)
    },
  )

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))('%s says where it was checked', (_id, entry) => {
    expect(entry.source).toMatch(/^https:\/\//)
    expect(entry.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s carries what its transport needs',
    (_id, entry) => {
      if (entry.transport === 'http') expect(entry.url).toMatch(/^https?:\/\//)
      else expect(entry.command).not.toBe('')
    },
  )

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s asks for at most one http secret',
    (_id, entry) => {
      // An `http` server carries one secret, its bearer token, because that is the one thing every
      // Provider writes (T136). A second one would be filled in and then silently dropped.
      if (entry.transport !== 'http') return
      expect(entry.fields.filter((field) => field.kind === 'secret').length).toBeLessThanOrEqual(1)
    },
  )

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s says where to get what it asks for',
    (_id, entry) => {
      const wantsASecret = entry.fields.some((field) => field.kind === 'secret' || field.kind === 'header-secret')
      if (!wantsASecret) return
      // Every link, with the placeholders filled the way the dialog fills them: a link that still
      // holds `{site}` is a link the boss's browser cannot open.
      const links = presetLinks(entry, filled(entry))
      expect(links.length).toBeGreaterThan(0)
      for (const link of links) expect(link.url).toMatch(/^https:\/\/[\w.-]+\//)
    },
  )

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s keeps its headers on the transport that has them, under names TinyCorp can carry',
    (_id, entry) => {
      const headers = entry.fields.filter((field) => field.kind === 'header' || field.kind === 'header-secret')
      // Only an `http` server is called with headers: on a `stdio` one they would be filled in and
      // then dropped, which is the failure this whole ticket is about (T245).
      if (entry.transport !== 'http') expect(headers).toEqual([])
      for (const field of headers) {
        expect(isMcpHeaderName(field.key)).toBe(true)
        expect(field.key.toLowerCase()).not.toBe('authorization')
      }
    },
  )

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s opens on a real endpoint, whatever the boss has not touched yet',
    (_id, entry) => {
      // A field with choices is answered before the dialog opens, so no placeholder is left in the
      // URL by a boss who never opened the control.
      const target = presetTarget(entry, presetDefaults(entry))
      if (entry.transport === 'http') expect(target).not.toMatch(/[{}]/)
    },
  )

  it.each(MCP_PRESETS.map((entry) => [entry.id, entry] as const))(
    '%s names every placeholder it writes',
    (_id, entry) => {
      const keys = entry.fields.filter((field) => field.kind === 'text').map((field) => field.key)
      for (const [, key] of [...presetTarget(entry).matchAll(/\{(\w+)\}/g)]) expect(keys).toContain(key)
    },
  )

  it('has no two presets under the same id or the same server name', () => {
    expect(new Set(MCP_PRESETS.map((entry) => entry.id)).size).toBe(MCP_PRESETS.length)
    expect(new Set(MCP_PRESETS.map((entry) => entry.server)).size).toBe(MCP_PRESETS.length)
  })

  it('has enough in it to be a gallery, so this file cannot pass by finding nothing', () => {
    expect(MCP_PRESETS.length).toBeGreaterThan(5)
  })
})

describe('Filling one in', () => {
  it('sends an http secret as the bearer token and never as an environment variable', () => {
    const input = presetInput(preset('github'), 'github', { token: 'ghp_supersecret' })

    expect(input).toEqual({
      name: 'github',
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      secret: 'ghp_supersecret',
    })
  })

  it('sends a stdio secret under the variable the server reads it from', () => {
    const input = presetInput(preset('sentry'), 'sentry', { SENTRY_ACCESS_TOKEN: 'sntryu_supersecret' })

    expect(input).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@sentry/mcp-server@latest'],
      env: {},
      secrets: { SENTRY_ACCESS_TOKEN: 'sntryu_supersecret' },
    })
  })

  it('writes a text field into the arguments, because that is where the server expects it', () => {
    const input = presetInput(preset('filesystem'), 'notes', { folder: '/work/notes' })

    expect(input).toMatchObject({
      name: 'notes',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/work/notes'],
      secrets: {},
    })
  })

  it('leaves an optional secret out rather than storing an empty one', () => {
    expect(presetInput(preset('context7'), 'context7', {})).toEqual({
      name: 'context7',
      transport: 'http',
      url: 'https://mcp.context7.com/mcp',
    })
  })

  it('falls back to the preset’s own name when the boss cleared the field', () => {
    expect(presetInput(preset('playwright'), '  ', {}).name).toBe('playwright')
  })
})

describe('A server that authenticates with named headers (T245)', () => {
  it('sends Datadog’s two keys as header secrets and puts the chosen site in the URL', () => {
    const input = presetInput(preset('datadog'), 'datadog', {
      site: 'datadoghq.eu',
      DD_API_KEY: 'api-supersecret',
      DD_APPLICATION_KEY: 'app-supersecret',
    })

    expect(input).toEqual({
      name: 'datadog',
      transport: 'http',
      url: 'https://mcp.datadoghq.eu/v1/mcp',
      headerSecrets: { DD_API_KEY: 'api-supersecret', DD_APPLICATION_KEY: 'app-supersecret' },
    })
    // Neither key is the bearer token, and neither is an environment variable: a `stdio` server's
    // `secrets` have nothing to do with an `http` one's headers.
    expect(input.secret).toBeUndefined()
    expect(input.secrets).toBeUndefined()
  })

  it('sends SigNoz’s instance URL as plain text and its key to the store, in the chosen region', () => {
    const input = presetInput(preset('signoz'), 'signoz', {
      region: 'eu',
      'X-SigNoz-URL': 'https://acme.eu.signoz.cloud',
      'SIGNOZ-API-KEY': 'key-supersecret',
    })

    expect(input).toEqual({
      name: 'signoz',
      transport: 'http',
      url: 'https://mcp.eu.signoz.cloud/mcp',
      headers: { 'X-SigNoz-URL': 'https://acme.eu.signoz.cloud' },
      headerSecrets: { 'SIGNOZ-API-KEY': 'key-supersecret' },
    })
  })

  it('takes the boss to the key pages of the site they chose, not another site’s', () => {
    const links = presetLinks(preset('datadog'), { site: 'us3.datadoghq.com' })

    expect(links.map((link) => link.url)).toEqual([
      'https://app.us3.datadoghq.com/organization-settings/api-keys',
      'https://app.us3.datadoghq.com/organization-settings/application-keys',
    ])
  })

  it('opens on the first choice of every select, so nothing has to be touched for the URL to work', () => {
    expect(presetDefaults(preset('datadog'))).toEqual({ site: 'datadoghq.com' })
    expect(presetDefaults(preset('signoz'))).toEqual({ region: 'us' })
    expect(presetTarget(preset('signoz'), presetDefaults(preset('signoz')))).toBe('https://mcp.us.signoz.cloud/mcp')
  })

  it('asks for every header it needs before the dialog will submit', () => {
    const problems = presetProblems(preset('datadog'), 'datadog', presetDefaults(preset('datadog')))

    expect(Object.keys(problems)).toEqual(['DD_API_KEY', 'DD_APPLICATION_KEY'])
  })
})

describe('What is wrong with a setup', () => {
  it('asks for a secret the server cannot work without', () => {
    expect(presetProblems(preset('github'), 'github', {})).toEqual({
      token: 'GitHub needs personal access token',
    })
  })

  it('does not ask for one the server works without', () => {
    expect(presetProblems(preset('context7'), 'context7', {})).toEqual({})
  })

  it('refuses a name this Company already has, in the catalogue’s own words', () => {
    const problems = presetProblems(preset('playwright'), 'playwright', {}, ['playwright'])

    expect(problems['name']).toBe('This Company already has a server named playwright')
  })

  it('refuses a name the catalogue could never hold', () => {
    expect(presetProblems(preset('playwright'), 'My Browser', {})['name']).toMatch(/Lower case letters/)
  })
})

describe('What a tile says it will cost', () => {
  it('names the field for a preset that wants one, and says so when it wants none', () => {
    expect(presetNeedLine(preset('github'))).toBe('Token')
    expect(presetNeedLine(preset('filesystem'))).toBe('Folder')
    expect(presetNeedLine(preset('playwright'))).toBe('No secret')
    expect(presetNeedLine(preset('context7'))).toBe('Token · optional')
  })

  it('leaves a picked-from-a-list field out, because the boss has nothing to go and get for it', () => {
    // Datadog's two keys are one word between them; the site it is on is not a cost.
    expect(presetNeedLine(preset('datadog'))).toBe('Token')
    expect(presetNeedLine(preset('signoz'))).toBe('Instance URL · Token')
  })
})

/**
 * Every field of a preset, filled with something, so the input is a complete one. A field with
 * choices is answered with one of its own: `value-for-site` in a URL is not a host, and the point
 * of these rules is that what comes out is something the catalogue and a browser both take.
 */
function filled(entry: McpPreset): Record<string, string> {
  return Object.fromEntries(
    entry.fields.map((field) => [field.key, field.options?.[0]?.value ?? `value-for-${field.key}`]),
  )
}
