import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { HOOK_TOKEN_ENV, HOOK_TOKEN_HEADER, hookCommand } from '../claude/adapter'
import { fakeProvider } from '../testing'
import { type HookReceiver, startHookReceiver } from './hook-receiver'

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(): Promise<{ engine: CompanyEngine; receiver: HookReceiver; employeeId: string; token: string }> {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
  })
  cleanups.push(() => engine.close())
  const receiver = await startHookReceiver(engine.sessions.receiveHook)
  cleanups.push(() => receiver.close())
  engine.createCompany({ folder: onDisk('/work/acme') })
  const { id } = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  engine.sessions.start(id)
  return { engine, receiver, employeeId: id, token: provider.spawnOf(id).request.hookToken }
}

function post(url: string, body: string, token?: string) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { [HOOK_TOKEN_HEADER]: token }) },
    body,
  })
}

describe('Hook receiver', () => {
  it('drives a Session’s status from hooks POSTed over HTTP', async () => {
    const { engine, receiver, employeeId, token } = await setup()

    const response = await post(
      receiver.url,
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1' }),
      token,
    )
    const busy = engine.sessions.get(employeeId).status
    await post(receiver.url, JSON.stringify({ hook_event_name: 'Stop', session_id: 's1' }), token)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(busy).toBe('busy')
    expect(engine.sessions.get(employeeId)).toMatchObject({ status: 'idle', lastHook: 'Stop' })
  })

  it('ignores hooks without the Session’s token', async () => {
    const { engine, receiver, employeeId } = await setup()

    const anonymous = await post(receiver.url, JSON.stringify({ hook_event_name: 'Stop' }))
    const forged = await post(receiver.url, JSON.stringify({ hook_event_name: 'Stop' }), 'forged')

    expect([anonymous.status, forged.status]).toEqual([200, 200])
    expect(engine.sessions.get(employeeId).status).toBe('starting')
  })

  it('rejects malformed bodies and other routes', async () => {
    const { receiver, token } = await setup()

    expect((await post(receiver.url, 'not json', token)).status).toBe(400)
    expect((await post(receiver.url, '[1]', token)).status).toBe(400)
    expect((await fetch(receiver.url)).status).toBe(404)
    expect((await post(receiver.url.replace('/hook', '/other'), '{}', token)).status).toBe(404)
  })

  it('receives what the Claude hook command sends from a Session’s environment', async () => {
    const { engine, receiver, employeeId, token } = await setup()

    await runHook(
      hookCommand(receiver.url),
      { [HOOK_TOKEN_ENV]: token },
      {
        hook_event_name: 'PreToolUse',
        session_id: 'from-shell',
        tool_name: 'Bash',
      },
    )

    expect(engine.sessions.get(employeeId)).toMatchObject({
      status: 'busy',
      lastHook: 'PreToolUse',
      providerSessionId: 'from-shell',
    })
  })

  it('makes the Claude hook command a silent no-op outside an app Session', async () => {
    const { engine, receiver, employeeId } = await setup()

    const result = await runHook(hookCommand(receiver.url), {}, { hook_event_name: 'Stop' })

    expect(result).toEqual({ code: 0, stdout: '' })
    expect(engine.sessions.get(employeeId).status).toBe('starting')
  })
})

function runHook(
  command: string,
  env: Record<string, string>,
  stdin: object,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile('sh', ['-c', command], { env: { PATH: process.env['PATH'], ...env } }, (error, stdout) => {
      if (error && typeof error.code !== 'number') reject(error)
      else resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout })
    })
    child.stdin!.end(JSON.stringify(stdin))
  })
}

/**
 * The self-test path (T167). A Session inside a WSL distro cannot reach this machine's loopback on
 * the default NAT network, and a firewall that eats its hooks looks exactly like a Session that is
 * thinking. So the app asks the network a question before a Session depends on the answer.
 */
describe('the health path', () => {
  it('answers the app’s own probe token', async () => {
    const receiver = await startHookReceiver(() => {}, { probeToken: 'probe-1' })
    cleanups.push(() => receiver.close())
    const health = receiver.url.replace('/hook', '/health')
    const answer = await fetch(health, { headers: { [HOOK_TOKEN_HEADER]: 'probe-1' } })
    expect(answer.status).toBe(200)
  })

  it('is not there for anyone else: it proves a path, and never a Session', async () => {
    const receiver = await startHookReceiver(() => {}, { probeToken: 'probe-1' })
    cleanups.push(() => receiver.close())
    const health = receiver.url.replace('/hook', '/health')
    expect((await fetch(health)).status).toBe(404)
    expect((await fetch(health, { headers: { [HOOK_TOKEN_HEADER]: 'guess' } })).status).toBe(404)
  })

  it('is not there at all when the app set no probe token', async () => {
    const receiver = await startHookReceiver(() => {})
    cleanups.push(() => receiver.close())
    expect((await fetch(receiver.url.replace('/hook', '/health'))).status).toBe(404)
  })
})

describe('where the receiver listens', () => {
  it('is loopback, and never everything', async () => {
    const receiver = await startHookReceiver(() => {})
    cleanups.push(() => receiver.close())
    expect(receiver.addresses).toEqual(['127.0.0.1'])
    expect(receiver.url.startsWith('http://127.0.0.1:')).toBe(true)
  })
})
