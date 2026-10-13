import { join } from 'node:path'
import {
  formatSource,
  type HandoffState,
  isMemoryKind,
  MEMORY_KIND_PLURAL,
  MEMORY_PAGE_MAX_CHARS,
  type MemoryKind,
  type MemoryPage,
  memoryKindFolder,
  parseSource,
  slugify,
} from '../../../shared/memory/company-memory'

/**
 * A Company-memory page on disk: YAML front matter and a markdown body. The files are the source
 * of truth, so this is the one place that knows how one is spelled.
 *
 * The front matter is deliberately not general YAML. It holds scalars and lists of scalars, in a
 * fixed order, which is all a page needs and all this parses — a page written by hand with a nested
 * map keeps the lines it does not understand out of the index rather than failing to open.
 */

/** Where the Company's pages live: `<company folder>/memory/company`, its own git repo. */
export function companyMemoryFolder(companyFolder: string): string {
  return join(companyFolder, 'memory', 'company')
}

/** `decisions/locale-handling-in-billing.md`, relative to the memory folder. */
export function pageFile(kind: MemoryKind, slug: string, archived = false): string {
  return `${archived ? 'archive' : memoryKindFolder(kind)}/${slug}.md`
}

/** Every folder a page can live in, which the store creates when it writes its first page. */
export const PAGE_FOLDERS = [
  'decisions',
  'conventions',
  'gotchas',
  'architecture',
  'glossary',
  'handoffs',
  'archive',
] as const

/** The kind a relative file path belongs to, or null for a path in no kind's folder. */
export function kindOfFile(relative: string): MemoryKind | null {
  const folder = relative.split('/')[0]
  const found = (Object.keys(MEMORY_KIND_PLURAL) as MemoryKind[]).find((kind) => memoryKindFolder(kind) === folder)
  return found ?? null
}

/** The fields a page is created with; everything else the store fills in. */
export interface NewPage {
  kind: MemoryKind
  title: string
  body: string
  slug?: string
  repos?: string[]
  sources?: string[]
  links?: string[]
  updatedBy: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  archived?: boolean
  handoff?: MemoryPage['handoff']
}

export function newPage(input: NewPage): MemoryPage {
  return {
    slug: input.slug ?? slugify(input.title),
    kind: input.kind,
    title: input.title,
    repos: input.repos ?? [],
    sources: (input.sources ?? []).map(parseSource),
    links: input.links ?? [],
    body: input.body,
    updatedBy: input.updatedBy,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
    handoff: input.handoff ?? (input.kind === 'handoff' ? { state: 'open', claimedBy: null, claimedAt: null } : null),
  }
}

/**
 * The file a page is written as. The order of the keys never changes, so a page edited twice makes
 * a diff about what changed and nothing else.
 */
export function serializePage(page: MemoryPage): string {
  const lines = ['---', `kind: ${page.kind}`, `title: ${quote(page.title)}`]
  lines.push(list('repos', page.repos))
  lines.push(list('sources', page.sources.map(formatSource)))
  lines.push(list('links', page.links))
  lines.push(`created: ${page.createdAt}`)
  lines.push(`updated: ${page.updatedAt}`)
  lines.push(`updatedBy: ${quote(page.updatedBy)}`)
  lines.push(`pinned: ${page.pinned}`)
  if (page.handoff) {
    lines.push(`handoff: ${page.handoff.state}`)
    lines.push(`claimedBy: ${page.handoff.claimedBy === null ? 'null' : quote(page.handoff.claimedBy)}`)
    lines.push(`claimedAt: ${page.handoff.claimedAt ?? 'null'}`)
  }
  lines.push('---', '')
  return `${lines.join('\n')}\n${page.body.replace(/\s+$/, '')}\n`
}

/**
 * A file back into a page. `slug` comes from the file name and `archived` from its folder, because
 * those are the file's own facts and never the front matter's.
 */
export function parsePage(relative: string, text: string, fallbackKind?: MemoryKind): MemoryPage | null {
  const name = relative.split('/').pop() ?? ''
  if (!name.endsWith('.md')) return null
  const slug = name.slice(0, -3)
  const archived = relative.split('/')[0] === 'archive'
  const { fields, body } = splitFrontMatter(text)
  const kind = isMemoryKind(fields['kind']) ? (fields['kind'] as MemoryKind) : (kindOfFile(relative) ?? fallbackKind)
  if (!kind || !slug) return null
  const handoffState = fields['handoff']
  return {
    slug,
    kind,
    title: scalar(fields['title']) || slug,
    repos: items(fields['repos']),
    sources: items(fields['sources']).map(parseSource),
    links: items(fields['links']),
    body: body.replace(/\s+$/, ''),
    updatedBy: scalar(fields['updatedBy']) || 'the Company',
    createdAt: scalar(fields['created']),
    updatedAt: scalar(fields['updated']) || scalar(fields['created']),
    pinned: scalar(fields['pinned']) === 'true',
    archived,
    handoff:
      kind === 'handoff'
        ? {
            state: isHandoffState(handoffState) ? handoffState : 'open',
            claimedBy: nullable(fields['claimedBy']),
            claimedAt: nullable(fields['claimedAt']),
          }
        : null,
  }
}

/** Refuses what would make a page nobody can open or read. */
export function assertWritablePage(page: Pick<MemoryPage, 'title' | 'body' | 'slug'>): void {
  if (!page.title.trim()) throw new Error('A memory page needs a title')
  if (!page.slug) throw new Error(`"${page.title}" has no letters or digits to make a file name from`)
  if (!page.body.trim()) throw new Error('A memory page needs a body')
  if (page.body.length > MEMORY_PAGE_MAX_CHARS) {
    throw new Error(
      `The page would hold ${page.body.length} characters; the limit is ${MEMORY_PAGE_MAX_CHARS}. ` +
        'Split it, or link a second page.',
    )
  }
}

/** `[[slug]]` links written in a body, in the order they appear and without repeats. */
export function bodyLinks(body: string): string[] {
  const found = new Set<string>()
  for (const match of body.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) found.add(match[1]!)
  return [...found]
}

type Fields = Record<string, string | string[] | undefined>

/** The front matter as fields, and everything after it. A file with no front matter is all body. */
function splitFrontMatter(text: string): { fields: Fields; body: string } {
  const normalised = text.replace(/\r\n/g, '\n')
  if (!normalised.startsWith('---\n')) return { fields: {}, body: normalised.trimStart() }
  const end = normalised.indexOf('\n---', 3)
  if (end === -1) return { fields: {}, body: normalised.trimStart() }
  const head = normalised.slice(4, end)
  const body = normalised.slice(normalised.indexOf('\n', end + 1) + 1)
  const fields: Fields = {}
  let listKey: string | null = null
  for (const line of head.split('\n')) {
    const bullet = /^\s*-\s+(.*)$/.exec(line)
    if (bullet && listKey) {
      ;(fields[listKey] as string[]).push(unquote(bullet[1]!))
      continue
    }
    const pair = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!pair) continue
    const [, key, raw] = pair
    if (raw!.trim() === '') {
      listKey = key!
      fields[key!] = []
      continue
    }
    listKey = null
    const inline = /^\[(.*)\]$/.exec(raw!.trim())
    if (inline) {
      fields[key!] = inline[1]!
        .split(',')
        .map((part) => unquote(part.trim()))
        .filter((part) => part !== '')
      continue
    }
    fields[key!] = unquote(raw!.trim())
  }
  return { fields, body: body.replace(/^\n+/, '') }
}

function list(key: string, values: readonly string[]): string {
  return `${key}: [${values.map(quote).join(', ')}]`
}

/**
 * Quoted only when it has to be, so the common page reads as plain text. A colon is safe: a field
 * is split at its first one, and a list item is read whole.
 */
function quote(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 _.:/#+@-]*$/.test(value) ? value : JSON.stringify(value)
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

function scalar(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function nullable(value: string | string[] | undefined): string | null {
  const text = scalar(value)
  return text === '' || text === 'null' ? null : text
}

function items(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item) => item !== '')
  return scalar(value) === '' ? [] : [scalar(value)]
}

function isHandoffState(value: string | string[] | undefined): value is HandoffState {
  return value === 'open' || value === 'claimed' || value === 'done'
}
