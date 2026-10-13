import { networkInterfaces } from 'node:os'
import { describe, expect, it } from 'vitest'
import { listenOn } from './listen-on'

/**
 * What the app's receivers may listen on (T167).
 *
 * The first check is the one that matters: the Company MCP server is chat, the board, approvals
 * and every repo, and a `0.0.0.0` here would put it on whatever wifi the boss is on. It is refused
 * in code rather than by convention, and this says so.
 */

function handler(): Parameters<typeof listenOn>[0] {
  return (_req, res) => res.writeHead(200).end('ok')
}

describe('a receiver', () => {
  it('refuses to listen on everything, whatever spelling is asked for', async () => {
    for (const everything of ['0.0.0.0', '::', '']) {
      await expect(listenOn(handler(), ['127.0.0.1', everything])).rejects.toThrow(/named addresses only/)
    }
  })

  it('listens on loopback', async () => {
    const server = await listenOn(handler(), ['127.0.0.1'])
    try {
      expect(server.addresses).toEqual(['127.0.0.1'])
      expect(server.port).toBeGreaterThan(0)
      const answer = await fetch(`http://127.0.0.1:${server.port}/`)
      expect(await answer.text()).toBe('ok')
    } finally {
      await server.close()
    }
  })

  it('answers on every address it was given, on one port', async () => {
    // A second address this machine really holds, so the test binds something real rather than
    // pretending: the loopback of the WSL switch stands in for it wherever this suite runs.
    const second = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address
    if (!second) return
    const server = await listenOn(handler(), ['127.0.0.1', second])
    try {
      expect(server.addresses).toEqual(['127.0.0.1', second])
      expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe('ok')
      expect(await (await fetch(`http://${second}:${server.port}/`)).text()).toBe('ok')
    } finally {
      await server.close()
    }
  })

  it('keeps working when an extra address will not bind, and says which did not', async () => {
    // 192.0.2.1 is the documentation range: never this machine's, so the bind fails.
    const server = await listenOn(handler(), ['127.0.0.1', '192.0.2.1'])
    try {
      expect(server.addresses).toEqual(['127.0.0.1'])
      expect(server.refused.map((entry) => entry.address)).toEqual(['192.0.2.1'])
    } finally {
      await server.close()
    }
  })

  it('fails when loopback itself will not bind: a receiver nobody can reach is not one', async () => {
    await expect(listenOn(handler(), ['192.0.2.1'])).rejects.toThrow()
  })

  it('closes every address it opened', async () => {
    const server = await listenOn(handler(), ['127.0.0.1'])
    const { port } = server
    await server.close()
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
  })
})
