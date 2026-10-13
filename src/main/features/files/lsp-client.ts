/**
 * The little LSP client the language layer speaks with (T115): JSON-RPC over a child process's
 * stdio, framed the way the protocol frames it. It knows nothing about TypeScript, nothing about
 * places and nothing about files — only how to ask a server something and get the answer back.
 *
 * Every request that goes unanswered is given up on rather than left hanging: a server that wedges
 * degrades the viewer, it never freezes it.
 */

/** What a spawned server looks like from here; a test hands over a pair of streams of its own. */
export interface LspProcess {
  stdin: { write(chunk: string): unknown; end?(): unknown }
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr?: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  on(event: 'exit' | 'error', listener: (...args: unknown[]) => void): unknown
  kill(signal?: string): unknown
}

/** One message off the wire: a response to something asked, or something the server said itself. */
interface Incoming {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export interface LspClientOptions {
  process: LspProcess
  /** How long any one request may take before it is given up on. */
  timeoutMs?: number
  /** Told when the server dies, so whoever holds it can say why the viewer went quiet. */
  onExit?(reason: string): void
  /** Told about a notification the server sent unasked, e.g. `textDocument/publishDiagnostics`. */
  onNotify?(method: string, params: unknown): void
  /**
   * How a file URI is spelled on each side, when the server is not on this machine (T259).
   *
   * A server inside a WSL distro speaks `file:///home/b/acme/src/x.ts`; the app speaks
   * `file://wsl.localhost/Arch/home/b/acme/src/x.ts`, because that is the file it opened and the
   * path the Files view holds. Every URI crossing the pipe is rewritten here rather than at the
   * twenty places that build or read one, and it happens on the **message**, never on the stream:
   * `Content-Length` is bytes, so a rewritten body has to be framed again after it is rewritten.
   */
  uris?: UriTranslation
}

/** The two directions a file URI is translated in. Each answers its input when there is nothing to do. */
export interface UriTranslation {
  toServer(uri: string): string
  toHost(uri: string): string
}

/**
 * The keys whose value is a URI in LSP. It is a closed list in the spec and this is the part of it
 * the viewer can see: matching by *name* rather than by "any string that starts with `file:`" is what
 * keeps a hover's markdown and a diagnostic's message — text a person reads — out of it.
 */
const URI_KEYS = new Set(['uri', 'rootUri', 'targetUri', 'newUri', 'oldUri', 'externalDocumentUri'])

/** The same message with every URI in it translated. Structure, arrays and everything else untouched. */
export function translateUris(value: unknown, translate: (uri: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => translateUris(item, translate))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      URI_KEYS.has(key) && typeof item === 'string' ? translate(item) : translateUris(item, translate),
    ]),
  )
}

export const DEFAULT_TIMEOUT_MS = 20_000

export interface LspClient {
  /** Asks the server something and waits for its answer. Rejects on an error or a timeout. */
  request<T>(method: string, params?: unknown): Promise<T>
  /** Tells the server something, expecting no answer. */
  notify(method: string, params?: unknown): void
  /** Whether the server is still there. */
  alive(): boolean
  /** Stops the server. Every request still waiting is rejected. */
  stop(): void
}

export function createLspClient({
  process: child,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onExit,
  onNotify,
  uris,
}: LspClientOptions): LspClient {
  const waiting = new Map<number, { resolve(value: never): void; reject(error: Error): void; timer: NodeJS.Timeout }>()
  let nextId = 1
  let dead: string | null = null
  let buffer = Buffer.alloc(0)

  function die(reason: string): void {
    if (dead !== null) return
    dead = reason
    for (const [, pending] of waiting) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    waiting.clear()
    onExit?.(reason)
  }

  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk])
    for (const message of takeMessages()) handle(message)
  })
  child.on('exit', (code) => die(`The language server stopped (${code ?? 'no code'})`))
  child.on('error', (error) => die(error instanceof Error ? error.message : String(error)))

  /** Every whole message the buffer holds, leaving any part of the next one behind. */
  function takeMessages(): Incoming[] {
    const messages: Incoming[] = []
    for (;;) {
      const end = buffer.indexOf(HEADER_END)
      if (end < 0) return messages
      const header = buffer.subarray(0, end).toString('ascii')
      const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1])
      // A header with no length is one nobody can frame: the stream is past saving.
      if (!Number.isFinite(length)) {
        buffer = Buffer.alloc(0)
        die('The language server sent something that is not LSP')
        return messages
      }
      const from = end + HEADER_END.length
      if (buffer.length < from + length) return messages
      const body = buffer.subarray(from, from + length).toString('utf8')
      buffer = buffer.subarray(from + length)
      try {
        const message = JSON.parse(body) as Incoming
        messages.push(uris ? (translateUris(message, uris.toHost) as Incoming) : message)
      } catch {
        // One unreadable message is skipped; the rest of the stream is still framed.
      }
    }
  }

  function handle(message: Incoming): void {
    // Something the server asks of us: answered with nothing, so it never waits on a client we
    // did not promise to be. Registering watchers and showing messages are not the viewer's job.
    if (message.method !== undefined && message.id !== undefined) return void send({ id: message.id, result: null })
    if (message.method !== undefined) return void onNotify?.(message.method, message.params)
    const pending = typeof message.id === 'number' ? waiting.get(message.id) : undefined
    if (!pending) return
    waiting.delete(message.id as number)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result as never)
  }

  function send(body: Record<string, unknown>): void {
    if (dead !== null) return
    const outgoing = { jsonrpc: '2.0', ...body }
    const text = JSON.stringify(uris ? translateUris(outgoing, uris.toServer) : outgoing)
    try {
      child.stdin.write(`Content-Length: ${Buffer.byteLength(text, 'utf8')}\r\n\r\n${text}`)
    } catch (error) {
      die(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    request(method, params) {
      if (dead !== null) return Promise.reject(new Error(dead))
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(new Error(`The language server did not answer ${method} in time`))
        }, timeoutMs)
        // Node would keep the app alive for a timer nobody is waiting on otherwise.
        timer.unref?.()
        waiting.set(id, { resolve: resolve as (value: never) => void, reject, timer })
        send({ id, method, params })
      })
    },
    notify(method, params) {
      send({ method, params })
    },
    alive: () => dead === null,
    stop() {
      die('The language server was stopped')
      try {
        child.stdin.end?.()
        child.kill()
      } catch {
        // Already gone; nothing to stop.
      }
    },
  }
}

const HEADER_END = '\r\n\r\n'
