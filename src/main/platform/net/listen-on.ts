import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * How the app's two receivers listen: on named addresses, one port, and never on everything (T167).
 *
 * The hook receiver and the Company MCP server used to be one `listen(port, '127.0.0.1')` each,
 * which was the whole security model and a good one — nothing outside this machine can reach the
 * board, the chat or the repos. A Provider running inside WSL breaks it in one direction only: on
 * the default NAT network the distro is not on this machine's loopback, so it has to dial the
 * host's address on the WSL virtual switch, and something has to be listening there.
 *
 * So a receiver listens on a **list** of addresses: loopback, and the one WSL address when a
 * Provider actually runs in a distro. `0.0.0.0` and `::` are refused here, loudly, rather than
 * left as an option somebody reaches for later — that would put the Company MCP server on the
 * office wifi. The token checks each receiver already does are untouched; this widens where the
 * bytes arrive, not who is answered.
 *
 * One port across every address, because a URL has one port: the first bind takes whatever the OS
 * gives it and the rest are bound to that number. An extra address that will not bind is skipped
 * and reported rather than fatal — the app still works on loopback, and the Providers card says a
 * Session in that distro cannot reach it.
 */

/** The addresses that mean "everything", and are never what this app wants. */
const EVERYTHING = new Set(['0.0.0.0', '::', '', '*'])

export interface LocalServer {
  /** The port every address is bound on. */
  port: number
  /** The addresses that really bound, in the order they were asked for. */
  addresses: string[]
  /** The addresses that were asked for and would not bind, with what went wrong. */
  refused: { address: string; reason: string }[]
  close(): Promise<void>
}

/**
 * One request handler, listening on each of `addresses` on a single port.
 *
 * The first address is the one that must bind: it is loopback, it is where everything the app
 * itself does goes, and a receiver that cannot bind it is a receiver that does not exist. The
 * rest are extra.
 */
export async function listenOn(handler: RequestListener, addresses: readonly string[], port = 0): Promise<LocalServer> {
  const wanted = [...new Set(addresses)]
  const everything = wanted.find((address) => EVERYTHING.has(address.trim()))
  if (everything !== undefined) {
    throw new Error(`Refusing to listen on ${everything || '(empty)'}: this app binds named addresses only`)
  }
  if (wanted.length === 0) throw new Error('Nothing to listen on')

  const servers: Server[] = []
  const bound: string[] = []
  const refused: { address: string; reason: string }[] = []
  let chosen = port
  for (const address of wanted) {
    const server = createServer(handler)
    try {
      await bind(server, chosen, address)
    } catch (error) {
      server.close()
      if (bound.length === 0) {
        await Promise.all(servers.map(shut))
        throw error
      }
      refused.push({ address, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    servers.push(server)
    bound.push(address)
    if (chosen === 0) chosen = (server.address() as AddressInfo).port
  }
  return {
    port: chosen,
    addresses: bound,
    refused,
    close: async () => void (await Promise.all(servers.map(shut))),
  }
}

function bind(server: Server, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => reject(error)
    server.once('error', failed)
    server.listen(port, address, () => {
      server.removeListener('error', failed)
      resolve()
    })
  })
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
