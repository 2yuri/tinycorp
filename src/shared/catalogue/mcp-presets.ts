/**
 * The popular MCP servers, set up in one step (T242, frame `gue8i`).
 *
 * Typing a server in by hand means knowing its package name, its arguments and which of its
 * environment variables is the secret one. A preset knows all three: TinyCorp writes the command
 * or the URL, and the boss fills only what the server genuinely cannot be given — a token, a
 * folder, the site their organisation is on — in a field whose value goes straight to the OS
 * secret store when it is one, and into the URL when it is not (T245).
 *
 * **Every entry is an official server**, and every command, package and URL below was read off
 * that project's own current documentation on the date in its `checked` field, with the page in
 * `source`. A preset whose facts are not checkable is not a preset: it is a guess the boss would
 * pay for. Three candidates were dropped for exactly that — see `docs/mcp-presets.md`.
 *
 * Adding one is one entry in {@link MCP_PRESETS}. Nothing else lists them: the screen draws the
 * table, and `mcp-presets.test.ts` checks every entry against the rules below.
 */

import { inMachineWords } from '../platform/machine-words'
import { type McpServerInput, type McpTransport, mcpServerProblems } from './mcp-servers'

/**
 * One thing the boss has to supply, and where its value goes.
 *
 * - `secret` — to the OS store, never read back: the bearer token of an `http` server, or a named
 *   environment value of a `stdio` one.
 * - `text` — written into the URL or the arguments, so it may not hold anything private.
 * - `header` — an HTTP header of an `http` server, plain text like a URL (T245).
 * - `header-secret` — an HTTP header whose value goes to the OS store (T245). This is how a server
 *   that authenticates with named headers is set up: Datadog wants two, SigNoz one.
 */
export type McpPresetFieldKind = 'secret' | 'text' | 'header' | 'header-secret'

/** One choice of a field the boss picks from rather than types into. */
export interface McpPresetOption {
  /** What is written into the URL or the arguments in the field's place. */
  value: string
  label: string
}

export interface McpPresetField {
  /**
   * For a `secret` on a `stdio` server, the environment variable its value arrives under. For a
   * `text` field, the placeholder `{key}` it replaces in the URL, the command or the arguments.
   * For a `header` or a `header-secret`, the header's own name.
   */
  key: string
  label: string
  /**
   * What the field is, under the box. A secret's helper says where the value goes, as
   * `{secretStore}` — {@link inMachineWords} puts in the platform's words (T265).
   */
  helper: string
  /** The grey text in an empty box. A field with {@link options} is a select and has none. */
  placeholder?: string
  kind: McpPresetFieldKind
  /**
   * The choices, when this is one of a fixed set rather than anything the boss can type: a
   * Datadog site, a SigNoz region. The first is what the dialog opens on, so the URL in front of
   * the boss is a real one before they have touched anything.
   */
  options?: readonly McpPresetOption[]
  /** A field the server works without. The boss may leave it empty. */
  optional?: boolean
}

/** A page the boss goes to for what a preset asks of them, and what that page is called. */
export interface McpPresetLink {
  url: string
  label: string
}

/**
 * The mark a preset's tile draws **when no logo is vendored for it** ({@link McpPresetLogo}). It
 * is a name rather than a drawing because `shared` may not name a component, and it is a union
 * rather than a string because the renderer's table is then exhaustive: a preset naming a mark
 * nobody draws fails to compile instead of drawing nothing.
 *
 * These are generic marks: a branch for a forge, a card for payments, a bug for error tracking.
 * A preset keeps one where neither icon set carries that service's logo under a licence this repo
 * can ship — see `docs/brand-logos.md` — and the service's own name is beside it either way.
 */
export type McpPresetIcon =
  | 'git-branch'
  | 'square-kanban'
  | 'bug'
  | 'credit-card'
  | 'database'
  | 'book-open'
  | 'globe'
  | 'folder-tree'
  | 'pen-tool'
  | 'activity'
  | 'chart'

/**
 * The service's own logo, as the file name — without `.svg` — of a logo vendored into
 * `src/renderer/src/ui/logos/`. A preset with none draws its {@link McpPresetIcon} instead.
 *
 * A name here for the same reason the mark is one: `shared` may not name a component. Which set
 * each file came from, what may be done to it and how to add one is `docs/brand-logos.md`.
 */
export type McpPresetLogo = 'github' | 'linear' | 'sentry' | 'stripe' | 'supabase' | 'datadog' | 'figma-color'

export interface McpPreset {
  id: string
  /** The service's own name, as its documentation writes it. */
  name: string
  /** The name the server takes in the catalogue, and the prefix the Employee sees its tools under. */
  server: string
  /** One line: what holding it lets an Employee do. `{machine}` is the boss's machine (T265). */
  summary: string
  /** The generic mark this preset draws when no logo is vendored for it. */
  icon: McpPresetIcon
  /** The service's own logo, drawn in place of {@link icon}. Left out where there is none. */
  logo?: McpPresetLogo
  transport: McpTransport
  /** `http`: where the server is, with `{key}` for any `text` field. */
  url?: string
  /** `stdio`: the command TinyCorp spawns. */
  command?: string
  /** `stdio`: its arguments, with `{key}` for any `text` field. */
  args?: string[]
  /** What the boss fills in. Empty for a server that needs nothing. */
  fields: readonly McpPresetField[]
  /**
   * Where the boss goes to get what this preset asks of them — one row in the dialog per page.
   * It is a list because a server can want two things from two pages: Datadog's API key and its
   * application key are made in different places, and sending the boss to one of them is sending
   * them back to the dialog with half of it filled in.
   */
  links?: readonly McpPresetLink[]
  /** Anything true about this server that the boss would otherwise find out by it not working. `{machine}` as above. */
  caveat?: string
  /** The page these facts were read off. */
  source: string
  /** The day they were read, ISO. A preset is a claim about somebody else's product. */
  checked: string
}

/**
 * The Datadog sites the MCP Server answers on, as `docs.datadoghq.com/mcp_server/setup/` renders
 * them per site. The value is the site's own domain, which the endpoint and the key pages are both
 * built from, so one choice fills the URL and both links.
 */
const DATADOG_SITES: readonly McpPresetOption[] = [
  { value: 'datadoghq.com', label: 'US1 · datadoghq.com' },
  { value: 'us3.datadoghq.com', label: 'US3 · us3.datadoghq.com' },
  { value: 'us5.datadoghq.com', label: 'US5 · us5.datadoghq.com' },
  { value: 'datadoghq.eu', label: 'EU · datadoghq.eu' },
  { value: 'ap1.datadoghq.com', label: 'AP1 · ap1.datadoghq.com' },
  { value: 'ap2.datadoghq.com', label: 'AP2 · ap2.datadoghq.com' },
  { value: 'uk1.datadoghq.com', label: 'UK1 · uk1.datadoghq.com' },
]

/** The SigNoz Cloud regions, which are the hosts `mcp.<region>.signoz.cloud` really resolves on. */
const SIGNOZ_REGIONS: readonly McpPresetOption[] = [
  { value: 'us', label: 'us · United States' },
  { value: 'eu', label: 'eu · Europe' },
  { value: 'in', label: 'in · India' },
  { value: 'us2', label: 'us2 · United States' },
  { value: 'eu2', label: 'eu2 · Europe' },
  { value: 'in2', label: 'in2 · India' },
]

/**
 * The presets, in the order the gallery draws them: the ones that want a token first, then the
 * ones that want nothing, because a boss scanning the grid is looking for what it will cost them.
 */
export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    server: 'github',
    summary: 'Issues, pull requests and code search on the repositories your token reaches.',
    icon: 'git-branch',
    logo: 'github',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    fields: [
      {
        key: 'token',
        label: 'Personal access token',
        helper: 'Goes straight to {secretStore}. It is never written to the Company database.',
        placeholder: 'github_pat_…',
        kind: 'secret',
      },
    ],
    links: [{ url: 'https://github.com/settings/personal-access-tokens/new', label: 'Create a token on github.com' }],
    source: 'https://github.com/github/github-mcp-server',
    checked: '2026-09-25',
  },
  {
    id: 'linear',
    name: 'Linear',
    server: 'linear',
    summary: 'Issues, projects and cycles, read and written through Linear’s own server.',
    icon: 'square-kanban',
    logo: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    fields: [
      {
        key: 'token',
        label: 'API key',
        helper: 'Goes straight to {secretStore}. Linear takes an API key in place of its sign-in flow.',
        placeholder: 'lin_api_…',
        kind: 'secret',
      },
    ],
    links: [{ url: 'https://linear.app/settings/api', label: 'Create an API key in Linear' }],
    source: 'https://linear.app/docs/mcp',
    checked: '2026-09-25',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    server: 'sentry',
    summary: 'Issues, events and stack traces from the projects your token can see.',
    icon: 'bug',
    logo: 'sentry',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server@latest'],
    fields: [
      {
        key: 'SENTRY_ACCESS_TOKEN',
        label: 'User auth token',
        helper: 'Goes straight to {secretStore}, and reaches the command as SENTRY_ACCESS_TOKEN.',
        placeholder: 'sntryu_…',
        kind: 'secret',
      },
    ],
    links: [
      { url: 'https://sentry.io/settings/account/api/auth-tokens/', label: 'Create a user auth token in Sentry' },
    ],
    caveat: 'The token needs the org, project, team and event scopes its documentation lists.',
    source: 'https://github.com/getsentry/sentry-mcp',
    checked: '2026-09-25',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    server: 'stripe',
    summary: 'The Stripe API and its documentation, at whatever your key is allowed to do.',
    icon: 'credit-card',
    logo: 'stripe',
    transport: 'http',
    url: 'https://mcp.stripe.com',
    fields: [
      {
        key: 'token',
        label: 'Agent API key',
        helper: 'Goes straight to {secretStore}. Use a sandbox key until you have watched what it does.',
        placeholder: 'sk_…',
        kind: 'secret',
      },
    ],
    links: [{ url: 'https://dashboard.stripe.com/apikeys', label: 'Create an agent key in the Stripe dashboard' }],
    caveat: 'Stripe stops accepting full-access and untagged restricted keys on 31 October 2026; create an Agent key.',
    source: 'https://docs.stripe.com/mcp',
    checked: '2026-09-25',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    server: 'supabase',
    summary: 'Your Supabase projects: schema, tables, logs and the SQL an Employee may run.',
    icon: 'database',
    logo: 'supabase',
    transport: 'http',
    url: 'https://mcp.supabase.com/mcp',
    fields: [
      {
        key: 'token',
        label: 'Personal access token',
        helper: 'Goes straight to {secretStore}. It reaches every project your account can open.',
        placeholder: 'sbp_…',
        kind: 'secret',
      },
    ],
    links: [
      { url: 'https://supabase.com/dashboard/account/tokens', label: 'Create a token in the Supabase dashboard' },
    ],
    source: 'https://supabase.com/docs/guides/getting-started/mcp',
    checked: '2026-09-25',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    server: 'datadog',
    summary: 'Metrics, logs, traces, monitors and incidents from the org your two keys reach.',
    icon: 'activity',
    logo: 'datadog',
    transport: 'http',
    // The path is `/v1/mcp` and the host is `mcp.` in front of the Datadog site, which is what the
    // site select fills in. Datadog's own docs render one endpoint per site behind a selector; the
    // seven below are that table, and the two FED sites are left out because the page says in as
    // many words that the MCP Server is not supported on them.
    url: 'https://mcp.{site}/v1/mcp',
    fields: [
      {
        key: 'site',
        label: 'Datadog site',
        helper: 'The site your organisation is on. It decides which server answers, so the wrong one cannot sign in.',
        kind: 'text',
        options: DATADOG_SITES,
      },
      {
        key: 'DD_API_KEY',
        label: 'API key',
        helper: 'Goes straight to {secretStore}, and reaches Datadog as the DD_API_KEY header.',
        placeholder: 'a1b2c3…',
        kind: 'header-secret',
      },
      {
        key: 'DD_APPLICATION_KEY',
        label: 'Application key',
        helper: 'Goes to {secretStore} too. It carries the permissions the Employee reads Datadog with.',
        placeholder: 'd4e5f6…',
        kind: 'header-secret',
      },
    ],
    links: [
      { url: 'https://app.{site}/organization-settings/api-keys', label: 'Create an API key in Datadog' },
      { url: 'https://app.{site}/organization-settings/application-keys', label: 'Create an application key' },
    ],
    caveat:
      'Datadog’s own advice is a scoped API key and application key from a service account with only the ' +
      'permissions it needs — an application key otherwise reads everything its owner can. Header keys are the way ' +
      'in for a client that cannot complete Datadog’s OAuth, which an Employee cannot. Add `?toolsets=apm,llmobs` ' +
      'to the URL afterwards for the product tools beyond the default set, or `?toolsets=all` for all of them.',
    source: 'https://docs.datadoghq.com/mcp_server/setup/',
    checked: '2026-09-25',
  },
  {
    id: 'signoz',
    name: 'SigNoz',
    server: 'signoz',
    summary: 'Traces, logs, metrics, dashboards and alerts from your SigNoz Cloud workspace.',
    icon: 'chart',
    transport: 'http',
    url: 'https://mcp.{region}.signoz.cloud/mcp',
    fields: [
      {
        key: 'region',
        label: 'Region',
        helper:
          'The region your workspace is in — Settings → Ingestion in SigNoz names it. Another region refuses the key.',
        kind: 'text',
        options: SIGNOZ_REGIONS,
      },
      {
        key: 'X-SigNoz-URL',
        label: 'Instance URL',
        helper:
          'Your own workspace, which the server reads as the X-SigNoz-URL header. Not a secret, so it is stored as it is.',
        placeholder: 'https://acme.us.signoz.cloud',
        kind: 'header',
      },
      {
        key: 'SIGNOZ-API-KEY',
        label: 'Service account API key',
        helper: 'Goes straight to {secretStore}, and reaches SigNoz as the SIGNOZ-API-KEY header.',
        placeholder: 'the key from a service account',
        kind: 'header-secret',
      },
    ],
    links: [
      {
        url: 'https://signoz.io/docs/manage/administrator-guide/iam/service-accounts/',
        label: 'Create a service account key in SigNoz',
      },
    ],
    caveat:
      'Header authentication is SigNoz’s own way in for a client that cannot complete its OAuth, which an Employee ' +
      'cannot. Only an Admin can create the key. Self-hosted SigNoz is not this preset: it runs a binary you install ' +
      'yourself, which TinyCorp does not fetch — add it as a stdio server once it is on this machine.',
    source: 'https://signoz.io/docs/ai/signoz-mcp-server/',
    checked: '2026-09-25',
  },
  {
    id: 'context7',
    name: 'Context7',
    server: 'context7',
    summary: 'Up-to-date documentation for the libraries an Employee is about to use.',
    icon: 'book-open',
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
    fields: [
      {
        key: 'token',
        label: 'API key',
        helper: 'Optional — it works without one, at a lower rate limit. A key goes to {secretStore}.',
        placeholder: 'ctx7sk_…',
        kind: 'secret',
        optional: true,
      },
    ],
    links: [{ url: 'https://context7.com/dashboard', label: 'Get a free key at context7.com' }],
    source: 'https://github.com/upstash/context7',
    checked: '2026-09-25',
  },
  {
    id: 'playwright',
    name: 'Playwright',
    server: 'playwright',
    summary: 'A real browser an Employee can drive: open a page, click, fill in, read it back.',
    icon: 'globe',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    fields: [],
    caveat: 'The first run downloads a browser, so the Session that starts it waits a moment.',
    source: 'https://github.com/microsoft/playwright-mcp',
    checked: '2026-09-25',
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    server: 'filesystem',
    summary: 'One folder on {machine}, read and written — and nothing outside it.',
    icon: 'folder-tree',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{folder}'],
    fields: [
      {
        key: 'folder',
        label: 'Folder',
        helper: 'The one folder the server may reach. It is not a secret, so it is stored as it is.',
        placeholder: '/Users/you/Documents/notes',
        kind: 'text',
      },
    ],
    source: 'https://github.com/modelcontextprotocol/servers',
    checked: '2026-09-25',
  },
  {
    id: 'figma',
    name: 'Figma',
    server: 'figma',
    summary: 'The frame selected in Figma: its layout, its variables and the code it implies.',
    icon: 'pen-tool',
    logo: 'figma-color',
    transport: 'http',
    url: 'http://127.0.0.1:3845/mcp',
    fields: [],
    caveat:
      'This server runs inside the Figma desktop app on {machine}. It has to be open, with its MCP server switched on.',
    source: 'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/',
    checked: '2026-09-25',
  },
]

/** What the card says the presets are, with `{secretStore}` for {@link inMachineWords}. */
export const MCP_PRESETS_SUB =
  'Servers set up in one step. TinyCorp fills in the command or the URL; you fill only the secret it asks for, and ' +
  'that goes straight to {secretStore}.'

/**
 * The line under a preset's name in the gallery: what it will ask for, in one short word.
 *
 * A secret is `Token` whatever the service calls it, because a tile is 167px wide in the column
 * the card sits in and `Personal access token` is an ellipsis there. The dialog says exactly what
 * it is, which is the moment the boss has to go and get one.
 */
export function presetNeedLine(preset: McpPreset): string {
  // A field the boss picks from a list costs them nothing to go and get, so it is not in the line:
  // this says what setting the server up will take, not how many controls the dialog has.
  const asked = preset.fields.filter((field) => !field.options)
  if (asked.length === 0) return 'No secret'
  const word = (field: McpPresetField) => (isPresetSecret(field) ? 'Token' : field.label)
  const wanted = asked.filter((field) => !field.optional)
  if (wanted.length === 0) return `${word(asked[0] as McpPresetField)} · optional`
  return [...new Set(wanted.map(word))].join(' · ')
}

/** What the setup dialog says it checked, and when — a preset is a claim about someone else's product. */
export function presetCheckedLine(preset: McpPreset): string {
  return `Only the name is kept in the Company database. Checked against ${preset.name}’s own docs on ${preset.checked}.`
}

/**
 * The mono line in the dialog: where the server is, or what it runs. Given what the boss has
 * filled in so far, every `text` placeholder is replaced by it — a Datadog site is chosen before
 * anything is typed, so the endpoint in front of the boss is the real one from the first frame.
 * Given nothing, the placeholders are left in, which is what the gallery's search reads.
 */
export function presetTarget(preset: McpPreset, values: Record<string, string> = {}): string {
  const line =
    preset.transport === 'http'
      ? (preset.url ?? '')
      : [preset.command, ...(preset.args ?? [])].filter(Boolean).join(' ')
  return fillPlaceholders(preset, line, values)
}

/**
 * Where the boss goes for what this preset asks of them, with the same placeholders filled in:
 * Datadog's key pages live on the site the boss just chose, and sending them to another site's
 * would be sending them somewhere their keys are not.
 */
export function presetLinks(preset: McpPreset, values: Record<string, string> = {}): McpPresetLink[] {
  return (preset.links ?? []).map((link) => ({ ...link, url: fillPlaceholders(preset, link.url, values) }))
}

/**
 * What the dialog opens with: the first choice of every field that has choices. A select with
 * nothing in it would leave `{site}` in the URL, and a boss who never touched the control would
 * be adding a server that cannot resolve.
 */
export function presetDefaults(preset: McpPreset): Record<string, string> {
  return Object.fromEntries(
    preset.fields.flatMap((field): [string, string][] => {
      const first = field.options?.[0]
      return first ? [[field.key, first.value]] : []
    }),
  )
}

/** Whether this field's value goes to the OS secret store rather than into the database. */
export function isPresetSecret(field: McpPresetField): boolean {
  return field.kind === 'secret' || field.kind === 'header-secret'
}

/** `{key}` replaced by what the boss gave for it, for every `text` field of this preset. */
function fillPlaceholders(preset: McpPreset, text: string, values: Record<string, string>): string {
  return preset.fields
    .filter((field) => field.kind === 'text')
    .reduce((out, field) => {
      const value = (values[field.key] ?? '').trim()
      return value === '' ? out : out.split(`{${field.key}}`).join(value)
    }, text)
}

/**
 * The preset a catalogue row is, or null.
 *
 * A row keeps no preset id: a server the boss typed in by hand and one a preset wrote are the same
 * row, and either can be renamed. So the match is the row's **name** against a preset's own
 * {@link McpPreset.server} — the name a preset fills the dialog with, and the prefix an Employee
 * sees the tools under. A boss who renamed their Linear server to `tickets` gets the generic row
 * back, which is the honest answer: nothing left on it says which service it is.
 */
export function presetForServer(name: string): McpPreset | null {
  const wanted = name.trim().toLowerCase()
  return MCP_PRESETS.find((preset) => preset.server.toLowerCase() === wanted) ?? null
}

/** What the search field matches on a preset: its name, what it does, and what it runs. */
export function presetMatches(preset: McpPreset, query: string, platform: string): boolean {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return true
  const summary = inMachineWords(preset.summary, platform)
  return `${preset.name} ${summary} ${presetTarget(preset)}`.toLowerCase().includes(wanted)
}

/** The fields a setup dialog can be wrong about: the name, or one of the preset's own fields. */
export type McpPresetProblems = Record<string, string>

/** What is wrong with a setup, as the dialog shows it and the engine refuses it. One function. */
export function presetProblems(
  preset: McpPreset,
  name: string,
  values: Record<string, string>,
  taken: readonly string[] = [],
): McpPresetProblems {
  const problems: McpPresetProblems = {}
  const nameProblem = mcpServerProblems(
    { name, transport: preset.transport, url: preset.url ?? '', command: preset.command ?? '' },
    taken,
  ).name
  if (nameProblem) problems['name'] = nameProblem
  for (const field of preset.fields) {
    if (field.optional) continue
    if ((values[field.key] ?? '').trim() === '')
      problems[field.key] = `${preset.name} needs ${field.label.toLowerCase()}`
  }
  return problems
}

/**
 * What the catalogue is given for a preset the boss has filled in.
 *
 * A `text` field is written into the URL or the arguments, because that is where the server
 * expects it and there is nothing secret about a folder. A `secret` field never is: on an `http`
 * server it becomes the bearer token, and on a `stdio` one it becomes a named value the OS store
 * holds and the Session's environment is filled from at spawn (T235).
 */
export function presetInput(preset: McpPreset, name: string, values: Record<string, string>): McpServerInput {
  const filled = (text: string) => fillPlaceholders(preset, text, values)
  const given = (kind: McpPresetFieldKind): Record<string, string> =>
    Object.fromEntries(
      preset.fields
        .filter((field) => field.kind === kind)
        .map((field): [string, string] => [field.key, (values[field.key] ?? '').trim()])
        .filter(([, value]) => value !== ''),
    )

  const secrets = given('secret')
  const server = name.trim() || preset.server

  if (preset.transport === 'http') {
    // An `http` server carries one bearer token, because that is the one thing every Provider has
    // always written (T136); a server that authenticates with named headers puts a value under each
    // of them instead (T245), and either way nothing secret is in what goes to the database.
    const token: string | undefined = Object.values(secrets)[0]
    const headers = given('header')
    const headerSecrets = given('header-secret')
    return {
      name: server,
      transport: 'http',
      url: filled(preset.url ?? ''),
      ...(token !== undefined && { secret: token }),
      ...(Object.keys(headers).length > 0 && { headers }),
      ...(Object.keys(headerSecrets).length > 0 && { headerSecrets }),
    }
  }
  return {
    name: server,
    transport: 'stdio',
    command: preset.command ?? '',
    args: (preset.args ?? []).map(filled),
    env: {},
    secrets,
  }
}
