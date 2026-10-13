import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  formatSource,
  MEMORY_KINDS,
  MEMORY_PAGE_MAX_CHARS,
  type MemoryPage,
  type MemoryPageSummary,
} from '../../../shared/memory/company-memory'
import type { McpCaller } from '../../core/engine'

/**
 * The Company memory's tools (T175): `memory_search`, `memory_read`, `memory_write` and
 * `memory_link`. They are the Company's shared pages — every Employee reads and writes the same
 * ones, on any Provider — beside `memory_write`'s older namesake, which is the Employee's own file.
 */
export function registerCompanyMemoryTools(server: McpServer, { companyMemory, employee }: McpCaller): void {
  server.registerTool(
    'memory_search',
    {
      description:
        'Search the Company memory: the pages everyone here shares, about decisions, conventions, ' +
        'gotchas, architecture and words this Company uses in its own way. Search it before you start ' +
        'a ticket and whenever you are about to guess — somebody has probably been here already. ' +
        'Returns titles and slugs, not bodies; read the ones you want with `memory_read`.',
      inputSchema: {
        query: z.string().describe('Words to look for in titles and bodies.'),
        kind: z.enum(MEMORY_KINDS).optional().describe('Only pages of this kind.'),
        repo: z.string().optional().describe('Only pages about this repo, by name.'),
      },
    },
    ({ query, kind, repo }) =>
      attempt(() => ({
        pages: companyMemory
          .search({ search: query, ...(kind && { kind }), ...(repo && { repo }) }, employee.name)
          .map(row),
      })),
  )

  server.registerTool(
    'memory_read',
    {
      description:
        'Read one page of the Company memory by its slug, as `memory_search` gives it. Reading counts ' +
        'as a use, which is what keeps a page from going cold.',
      inputSchema: { slug: z.string().describe('The page, e.g. `locale-handling-in-billing`.') },
    },
    ({ slug }) =>
      attempt(() => {
        const page = companyMemory.read(slug, employee.name)
        if (!page) throw new Error(`There is no memory page "${slug}"`)
        return full(page)
      }),
  )

  server.registerTool(
    'memory_write',
    {
      description:
        'Write what you learned to the Company memory, so every colleague on every Provider has it too. ' +
        'Write when something is durable: a decision and why, a convention the team now holds to, a ' +
        'gotcha that cost you an hour, how a part of the system fits together, a word this Company uses ' +
        'its own way. Not a status update, and not what the ticket already says. A page with a title ' +
        'that already exists is added to; pass mode "replace" to rewrite it. Link the ticket, PR or ' +
        `thread it came from in \`sources\`. At most ${MEMORY_PAGE_MAX_CHARS} characters per page. ` +
        'Your own private notes still go to your memory file — this is the Company’s.',
      inputSchema: {
        kind: z.enum(MEMORY_KINDS).describe('decision, convention, gotcha, architecture or glossary.'),
        title: z.string().describe('What the page is about, in a few words. It names the file.'),
        body: z.string().describe('Markdown. Say the thing, then why.'),
        sources: z
          .array(z.string())
          .optional()
          .describe('Where it came from: `ticket:TC-142`, `pr:billing-api#88`, `commit:9f2c1ab`.'),
        repos: z.array(z.string()).optional().describe('Repo names the page is about.'),
        mode: z.enum(['append', 'replace']).optional().describe('"append" (default) or "replace".'),
      },
    },
    ({ kind, title, body, sources, repos, mode }) =>
      attempt(() => {
        // A Handoff is the app's own page: it is written when a Provider switch moves a Session, and
        // claimed, never composed by an agent.
        if ((kind as string) === 'handoff') throw new Error('Handoff pages are written by the app, not by you')
        const page = companyMemory.write({
          kind,
          title,
          body,
          ...(sources !== undefined && { sources }),
          ...(repos !== undefined && { repos }),
          ...(mode !== undefined && { mode }),
          by: employee.name,
        })
        return { status: 'saved', slug: page.slug, path: `memory/company/${page.kind}s/${page.slug}.md` }
      }),
  )

  server.registerTool(
    'memory_link',
    {
      description:
        'Link two Company memory pages to each other, so whoever opens one finds the other. Use it when ' +
        'a page you wrote only makes sense beside one that is already there.',
      inputSchema: { a: z.string().describe('One page’s slug.'), b: z.string().describe('The other’s.') },
    },
    ({ a, b }) =>
      attempt(() => {
        companyMemory.link(a, b, employee.name)
        return { status: 'linked', a, b }
      }),
  )
}

function row(page: MemoryPageSummary) {
  return {
    slug: page.slug,
    kind: page.kind,
    title: page.title,
    repos: page.repos,
    sources: page.sources.map(formatSource),
    updated_by: page.updatedBy,
    updated_at: page.updatedAt,
    ...(page.cold && { cold: true }),
    ...(page.pinned && { pinned: true }),
  }
}

function full(page: MemoryPage) {
  return {
    slug: page.slug,
    kind: page.kind,
    title: page.title,
    repos: page.repos,
    sources: page.sources.map(formatSource),
    links: page.links,
    body: page.body,
    updated_by: page.updatedBy,
    updated_at: page.updatedAt,
    ...(page.handoff && { handoff: page.handoff.state, claimed_by: page.handoff.claimedBy }),
  }
}

function attempt(action: () => unknown): CallToolResult {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(action()) }] }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    }
  }
}
