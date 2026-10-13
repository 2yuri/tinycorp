import type { IncomingMessage } from 'node:http'
import { HOOK_HEALTH_PATH, LOOPBACK, listenOn } from '../../platform'
import { HOOK_TOKEN_HEADER } from '../claude/adapter'
import type { HookPayload } from '../provider-adapter'

export interface HookReceiver {
  /** The URL hooks POST to, on loopback. A Session inside WSL is given the host's address instead. */
  url: string
  /** Every address it really bound, loopback first. Never `0.0.0.0` — `listenOn` refuses that. */
  addresses: string[]
  /** The extra addresses that would not bind, e.g. a WSL switch that went away. */
  refused: { address: string; reason: string }[]
  close(): Promise<void>
}

const MAX_BODY_BYTES = 1024 * 1024

export interface HookReceiverOptions {
  port?: number
  /**
   * Everywhere to listen, loopback first (T167). A Provider running inside a WSL distro on the
   * default NAT network cannot see this machine's loopback, so the host's address on the WSL
   * switch is bound as well — that one, and nothing else.
   */
  addresses?: readonly string[]
  /**
   * The token {@link HOOK_HEALTH_PATH} answers to: the app's own, so a `curl` from inside a distro
   * can find out whether it can reach this receiver at all before a Session depends on it. It
   * proves the path, never a Session — nothing about a Session's own token is relaxed by it.
   */
  probeToken?: string
}

/**
 * The HTTP endpoint Session hooks POST their stdin JSON to. Every well-formed hook is answered
 * `{}` at once so the CLI is never held up.
 *
 * It answers on named addresses only — loopback, plus the WSL switch when a Provider runs in a
 * distro — and every hook is attributed by the token in its header, exactly as before.
 */
export async function startHookReceiver(
  onHook: (token: string, payload: HookPayload) => void,
  { port = 0, addresses = [LOOPBACK], probeToken }: HookReceiverOptions = {},
): Promise<HookReceiver> {
  const server = await listenOn(
    (req, res) => {
      const token = req.headers[HOOK_TOKEN_HEADER]
      // The self-test, answered before anything else and only for the app's own probe token: it
      // says the network path works, and says nothing about any Session.
      if (req.method === 'GET' && req.url === HOOK_HEALTH_PATH) {
        if (!probeToken || token !== probeToken) return void res.writeHead(404).end()
        return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      }
      if (req.method !== 'POST' || req.url !== '/hook') {
        res.writeHead(404).end()
        return
      }
      readBody(req).then(
        (body) => {
          let payload: unknown
          try {
            payload = JSON.parse(body)
          } catch {
            res.writeHead(400).end()
            return
          }
          if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
            res.writeHead(400).end()
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
          if (typeof token === 'string' && token) onHook(token, payload as HookPayload)
        },
        () => res.writeHead(413).end(),
      )
    },
    addresses,
    port,
  )
  return {
    url: `http://${server.addresses[0]}:${server.port}/hook`,
    addresses: server.addresses,
    refused: server.refused,
    close: () => server.close(),
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Hook body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
