import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { registerApprovalTools } from '../../features/approvals'
import { registerBoardTools } from '../../features/board'
import { registerChatTools } from '../../features/chat'
import { registerMergeTools } from '../../features/code'
import { registerEnvTools } from '../../features/environments'
import { registerHiringTools } from '../../features/hiring'
import { registerCompanyMemoryTools, registerNotesTools } from '../../features/memory'
import { registerPlanningTools } from '../../features/planning'
import { registerRepoTools } from '../../features/repos'
import { registerReviewTools, registerSecurityTools } from '../../features/review'
import { registerSessionTools, registerSubSessionTools } from '../../features/sessions'
import { registerTestTools } from '../../features/testing'
import { LOOPBACK, listenOn } from '../../platform'
import type { CompanyEngine, McpCaller } from './company-engine'

/** Adds one area's tools, acting as `caller`. */
export type ToolGroup = (server: McpServer, caller: McpCaller) => void

/** Every tool area the Company exposes. Append new areas here. */
const toolGroups: ToolGroup[] = [
  registerChatTools,
  registerApprovalTools,
  registerBoardTools,
  registerPlanningTools,
  registerHiringTools,
  registerNotesTools,
  registerCompanyMemoryTools,
  registerReviewTools,
  registerSecurityTools,
  registerRepoTools,
  registerMergeTools,
  registerTestTools,
  registerSessionTools,
  registerEnvTools,
]

/**
 * Everything a sub-session gets (T163): its report, and not one tool more. It has no way to start
 * a Session, chat, move a ticket, open a PR or merge — one level deep is what its token reaches,
 * here, and not what its instructions ask of it.
 *
 * What that is not: a wall between two processes of the same OS user. A sub-session that goes
 * looking can read its parent's token out of the parent's own environment or out of the file its
 * adapter wrote — every Employee runs as the boss, with no sandbox (T199, finding H5). The tokens
 * are the whole of the enforcement against a Session that does not go looking, and `SECURITY.md`
 * says so out loud rather than leaving this comment to claim more than it can.
 */
const subSessionToolGroups: ToolGroup[] = [registerSubSessionTools]

/** The tool areas a caller reaches: a sub-session's are its own. */
export function toolGroupsFor(caller: Pick<McpCaller, 'subSession'>): readonly ToolGroup[] {
  return caller.subSession ? subSessionToolGroups : toolGroups
}

export interface CompanyMcpServer {
  /** The streamable HTTP endpoint of one Company's MCP server, on loopback. */
  urlFor(companyId: string): string
  /** Every address it really bound, loopback first. Never `0.0.0.0` — `listenOn` refuses that. */
  addresses: string[]
  /** The extra addresses that would not bind. */
  refused: { address: string; reason: string }[]
  close(): Promise<void>
}

const MAX_BODY_BYTES = 1024 * 1024
const ROUTE = /^\/companies\/([^/]+)\/mcp$/

/**
 * The Company MCP servers, over streamable HTTP on named addresses — loopback, and the WSL switch
 * when a Provider runs inside a distro (T167), never everything: one endpoint per Company,
 * `/companies/<id>/mcp`. Each request carries `Authorization: Bearer <token>`, the token
 * of a running Session of that Company; the caller is resolved from it. Stateless: every
 * POST gets a fresh server bound to its caller.
 */
export async function startCompanyMcpServer(
  engine: Pick<CompanyEngine, 'mcpCaller'>,
  { port = 0, addresses = [LOOPBACK] }: { port?: number; addresses?: readonly string[] } = {},
): Promise<CompanyMcpServer> {
  const server = await listenOn(
    (req, res) => {
      const route = ROUTE.exec(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (!route) return void res.writeHead(404).end()
      if (req.method !== 'POST') {
        return void res.writeHead(405, { allow: 'POST' }).end()
      }
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
      const companyId = safeDecode(route[1]!)
      const caller = token && companyId ? engine.mcpCaller(companyId, token) : null
      if (!caller) return void jsonError(res, 401, 'Unknown or expired Employee token')
      handle(req, res, caller).catch(() => {
        if (!res.headersSent) jsonError(res, 500, 'Internal error')
      })
    },
    addresses,
    port,
  )
  return {
    urlFor: (companyId) =>
      `http://${server.addresses[0]}:${server.port}/companies/${encodeURIComponent(companyId)}/mcp`,
    addresses: server.addresses,
    refused: server.refused,
    close: () => server.close(),
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, caller: McpCaller): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return jsonError(res, 400, 'Body must be JSON')
  }
  const server = new McpServer({ name: 'company', version: '1.0.0' })
  for (const group of toolGroupsFor(caller)) group(server, caller)
  // Stateless: no session id generator, so every request gets its own transport. The SDK's docs
  // spell that `sessionIdGenerator: undefined`, but it declares the option `?: () => string` and
  // reads it straight off the object, so with `exactOptionalPropertyTypes` on it is left out here
  // instead (SDK 1.30).
  const transport = new StreamableHTTPServerTransport({})
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  // The same gap the other way: `Transport` declares `onclose?: () => void` and the transport the
  // SDK ships implements `onclose: (() => void) | undefined`.
  await server.connect(transport as Transport)
  await transport.handleRequest(req, res, body)
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  res
    .writeHead(status, { 'content-type': 'application/json' })
    .end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
