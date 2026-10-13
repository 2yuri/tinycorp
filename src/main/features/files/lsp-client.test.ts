import { describe, expect, it } from 'vitest'
import { createLspClient, type LspProcess } from './lsp-client'

/** A server on the end of a pipe, which a test answers by hand. */
function fakeServer() {
  const written: string[] = []
  let onData: (chunk: Buffer) => void = () => {}
  let onExit: (code: unknown) => void = () => {}
  let killed = 0
  const process: LspProcess = {
    stdin: { write: (chunk) => written.push(String(chunk)), end: () => {} },
    stdout: {
      on: (_event, listener) => {
        onData = listener as (chunk: Buffer) => void
      },
    },
    on: (event, listener) => {
      if (event === 'exit') onExit = listener as (code: unknown) => void
    },
    kill: () => killed++,
  }
  return {
    process,
    written,
    killed: () => killed,
    /** What the client asked, parsed off the wire. */
    asked: () => written.map((frame) => JSON.parse(frame.slice(frame.indexOf('\r\n\r\n') + 4))),
    /** The server answering, framed the way LSP frames it. */
    say(message: unknown) {
      const body = JSON.stringify(message)
      onData(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8'))
    },
    /** The server answering in pieces, as a pipe really delivers them. */
    dribble(message: unknown) {
      const body = JSON.stringify(message)
      const frame = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`, 'utf8')
      for (let at = 0; at < frame.length; at += 7) onData(frame.subarray(at, at + 7))
    },
    exit: (code: number) => onExit(code),
  }
}

describe('Talking to a language server', () => {
  it('frames what it asks with a content length, and answers by id', async () => {
    const server = fakeServer()
    const client = createLspClient({ process: server.process })
    const answer = client.request<{ ok: boolean }>('textDocument/hover', { line: 4 })
    expect(server.written[0]).toMatch(/^Content-Length: \d+\r\n\r\n\{/)
    expect(server.asked()[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'textDocument/hover',
      params: { line: 4 },
    })
    server.say({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    await expect(answer).resolves.toEqual({ ok: true })
  })

  it('puts an answer back together when the pipe delivers it in pieces', async () => {
    const server = fakeServer()
    const client = createLspClient({ process: server.process })
    const answer = client.request<string>('textDocument/definition')
    server.dribble({ jsonrpc: '2.0', id: 1, result: 'src/main/engine/files.ts' })
    await expect(answer).resolves.toBe('src/main/engine/files.ts')
  })

  it('answers two questions asked at once, each with its own answer', async () => {
    const server = fakeServer()
    const client = createLspClient({ process: server.process })
    const first = client.request<number>('one')
    const second = client.request<number>('two')
    server.say({ jsonrpc: '2.0', id: 2, result: 2 })
    server.say({ jsonrpc: '2.0', id: 1, result: 1 })
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
  })

  it('hands on what the server says unasked', () => {
    const server = fakeServer()
    const said: [string, unknown][] = []
    createLspClient({ process: server.process, onNotify: (method, params) => said.push([method, params]) })
    server.say({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a.ts' } })
    expect(said).toEqual([['textDocument/publishDiagnostics', { uri: 'file:///a.ts' }]])
  })

  it('answers what the server asks of it with nothing, so it never waits on us', () => {
    const server = fakeServer()
    createLspClient({ process: server.process })
    server.say({ jsonrpc: '2.0', id: 'ts1', method: 'client/registerCapability', params: {} })
    expect(server.asked()).toEqual([{ jsonrpc: '2.0', id: 'ts1', result: null }])
  })

  it('turns an error answer into a rejection, and leaves the client alive', async () => {
    const server = fakeServer()
    const client = createLspClient({ process: server.process })
    const answer = client.request('textDocument/hover')
    server.say({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'InvalidParams' } })
    await expect(answer).rejects.toThrow('InvalidParams')
    expect(client.alive()).toBe(true)
  })

  it('gives up on a question the server never answers', async () => {
    const server = fakeServer()
    const client = createLspClient({ process: server.process, timeoutMs: 5 })
    await expect(client.request('textDocument/hover')).rejects.toThrow(/did not answer/)
  })

  it('rejects everything still waiting when the server dies, and says so once', async () => {
    const server = fakeServer()
    const reasons: string[] = []
    const client = createLspClient({ process: server.process, onExit: (reason) => reasons.push(reason) })
    const answer = client.request('textDocument/hover')
    server.exit(1)
    await expect(answer).rejects.toThrow(/stopped/)
    expect(client.alive()).toBe(false)
    expect(reasons).toHaveLength(1)
    await expect(client.request('textDocument/hover')).rejects.toThrow(/stopped/)
  })

  it('kills the server when it is stopped, and stays stopped', () => {
    const server = fakeServer()
    const client = createLspClient({ process: server.process })
    client.stop()
    expect(server.killed()).toBe(1)
    expect(client.alive()).toBe(false)
    client.notify('textDocument/didChange')
    expect(server.written).toEqual([])
  })
})
