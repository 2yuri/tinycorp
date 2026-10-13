// `pnpm provider:new <id>`. No shebang: it is run as `node tools/provider-new.mjs`, and a test
// imports it — a `#!` line at the top of an imported module is a syntax error under the runner on
// Windows (T166).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `pnpm provider:new <id>` — the first move of a Provider pull request, as a command.
 *
 * It copies `src/main/providers/example/`, renames it, writes the catalogue entry, the
 * registry line and the row in the docs table, and leaves exactly one file to fill in. A
 * contributor's first step should not be a paste they can get wrong: this is what makes
 * "one folder and two lines" true rather than aspirational.
 *
 * It refuses an id that already exists and never overwrites a file.
 *
 *   pnpm provider:new goose --name Goose --command goose
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

/** The files the command touches, relative to the repo root. */
export const CATALOGUE = 'src/shared/domain/providers.ts'
/** The Provider module: one folder per Provider, the registry and the conformance suite beside them. */
export const PROVIDERS = 'src/main/providers'
export const REGISTRY = `${PROVIDERS}/provider-registry.ts`
export const DOCS = 'docs/providers.md'
export const TEMPLATE = `${PROVIDERS}/example`
/** The template files a new Provider gets. `filled.ts` and the template's own test stay behind. */
export const TEMPLATE_FILES = ['cli.ts', 'cli-todo.ts', 'adapter.ts']

/** An id is a lowercase word, the way `Employee.provider` stores it and the folder is named. */
const ID = /^[a-z][a-z0-9-]{1,30}$/

/** `open-code` → `OpenCode`, for the factory and the types. */
export function pascal(id) {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** `open-code` → `OPEN_CODE`, for the constants. */
export function upper(id) {
  return id.replace(/-/g, '_').toUpperCase()
}

/** The template's text, with every `example` in it replaced by this Provider's own names. */
export function rename(text, id, name) {
  return text
    .replaceAll('__PASCAL__', pascal(id))
    .replaceAll('__UPPER__', upper(id))
    .replaceAll('__NAME__', name)
    .replaceAll('__ID__', id)
    .replaceAll('Example', pascal(id))
    .replaceAll('EXAMPLE', upper(id))
    .replaceAll('example', id)
}

/** The catalogue entry, inserted last so the first entry stays the default Provider. */
export function withCatalogueEntry(source, { id, name, command }) {
  const close = '\n] as const satisfies readonly ProviderEntry[]'
  if (!source.includes(close)) throw new Error(`${CATALOGUE}: cannot find the end of PROVIDER_CATALOGUE`)
  const entry = `  {
    id: '${id}',
    name: '${name}',
    shortName: '${name}',
    command: '${command}',
    // TODO: true only once TinyCorp can read this Provider's usage without spending it.
    readsUsage: false,
    // TODO: the folder this product reads skills from, e.g. '.claude/skills', or null when it
    // reads none. Name one only once the CLI has been seen to read it, and implement
    // installSkills in the adapter when you do.
    skillsFolder: null,
    icon: 'terminal',
    auth: {
      how: 'TODO: how the boss signs in',
      signOut: '${command} logout',
      // TODO: the product's own login after the command, and the steps the sign-in modal lists.
      signIn: { args: ['login'], steps: [{ title: 'TODO: what the boss does in the terminal' }] },
    },
    maintainer: 'TODO: your name or your team',
    models: [
      // TODO: this Provider's models. Every id is unique across the whole catalogue.
      { id: '${id}-default-balanced', label: 'TODO · balanced', model: 'TODO', effort: 'medium' },
    ],
  },`
  // The newline is the one `close` took with it: without it the new entry lands on the
  // previous entry's closing line, and the catalogue comes back malformed.
  return source.replace(close, `\n${entry}${close}`)
}

/** The registry line, where the adapter is built, and the import above it. */
export function withRegistryLine(source, { id }) {
  const opens = 'const ADAPTERS: Record<Provider, (options: AdapterOptions) => ProviderAdapter> = {'
  const at = source.indexOf(opens)
  const closes = at === -1 ? -1 : source.indexOf('\n}\n', at)
  if (closes === -1) throw new Error(`${REGISTRY}: cannot find the ADAPTERS table`)
  const factory = `create${pascal(id)}Adapter`
  const line = `\n  ${quoted(id)}: (options) => ${factory}(shared('${id}', options)),`
  const withLine = source.slice(0, closes) + line + source.slice(closes)

  const importAnchor = "import type { ProviderAdapter, ProviderAdapters, SpawnPty } from './provider-adapter'"
  if (!withLine.includes(importAnchor)) throw new Error(`${REGISTRY}: cannot find where the adapters are imported`)
  return withLine.replace(importAnchor, `import { ${factory} } from './${id}/adapter'\n${importAnchor}`)
}

/** The row in the docs table, so a Provider PR cannot land without one. */
export function withDocsRow(source, { id, name, command }) {
  const marker = '<!-- providers:end -->'
  if (!source.includes(marker)) throw new Error(`${DOCS}: cannot find the ${marker} marker`)
  const row = `| ${name} | \`${command}\` | TODO | No | TODO |\n`
  return source.replace(marker, `${row}${marker}`)
}

/** A key that needs no quotes stays unquoted, the way the two shipped Providers are written. */
function quoted(id) {
  return /^[a-z][a-z0-9]*$/.test(id) ? id : `'${id}'`
}

/** Everything the command would write, as `{ path: contents }`. Nothing is written here. */
export function planProvider(root, { id, name, command }) {
  if (!ID.test(id)) throw new Error(`"${id}" is not a Provider id: lowercase letters, digits and dashes`)
  const catalogue = read(root, CATALOGUE)
  if (new RegExp(`\\bid: '${id}'`).test(catalogue)) {
    throw new Error(`${id} is already in ${CATALOGUE} — pick another id, or finish the one that is there`)
  }
  const folder = `${PROVIDERS}/${id}`
  if (existsSync(join(root, folder))) throw new Error(`${folder} already exists — nothing was written`)

  const files = {
    [CATALOGUE]: withCatalogueEntry(catalogue, { id, name, command }),
    [REGISTRY]: withRegistryLine(read(root, REGISTRY), { id }),
    [DOCS]: withDocsRow(read(root, DOCS), { id, name, command }),
  }
  for (const file of TEMPLATE_FILES) {
    files[`${folder}/${file}`] = rename(read(root, `${TEMPLATE}/${file}`), id, name)
  }
  files[`${folder}/adapter.test.ts`] = rename(read(root, `${TEMPLATE}/conformance.test.template`), id, name)
  return files
}

function read(root, path) {
  return readFileSync(join(root, path), 'utf8')
}

function write(root, path, contents) {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
}

export function createProvider(root, options) {
  const files = planProvider(root, options)
  for (const [path, contents] of Object.entries(files)) write(root, path, contents)
  return Object.keys(files)
}

function parse(argv) {
  const [id, ...rest] = argv
  const flags = {}
  for (let i = 0; i < rest.length; i += 2) flags[rest[i]?.replace(/^--/, '')] = rest[i + 1]
  return {
    id,
    name: flags.name ?? pascal(id ?? ''),
    command: flags.command ?? id,
    root: flags.root ? join(process.cwd(), flags.root) : REPO,
  }
}

function main() {
  const { id, name, command, root } = parse(process.argv.slice(2))
  if (!id) {
    console.error('Usage: pnpm provider:new <id> [--name "<Product>"] [--command <cli>]')
    process.exit(1)
  }
  let written
  try {
    written = createProvider(root, { id, name, command })
  } catch (error) {
    console.error(`provider:new: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`${name} is registered. Written:\n${written.map((path) => `  ${path}`).join('\n')}\n`)
  console.log(`Next:
  1. Fill in ${PROVIDERS}/${id}/cli-todo.ts — eleven spellings, one per question.
  2. pnpm test — the conformance suite tells you what is still missing, in words.
  3. Finish the TODOs in ${CATALOGUE} (models, auth, maintainer) and in ${DOCS}.
  4. Read docs/providers.md and CONTRIBUTING.md before you open the pull request.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
