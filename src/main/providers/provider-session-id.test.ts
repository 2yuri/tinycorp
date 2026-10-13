import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createClaudeAdapter } from './claude/adapter'
import { createCodexAdapter } from './codex/adapter'
import { createOpencodeAdapter } from './opencode/adapter'
import { hookSessionId, isProviderSessionId, type ProviderAdapter } from './provider-adapter'

/**
 * A provider session id is the one string a Session chooses for itself: it comes back in a hook,
 * which a Session holds the token for by design, and it is then spent as CLI argv and as a file
 * path (T199-H1, the security review's finding H1). These are the shapes that may make that trip.
 */

const shared = { hookUrl: 'http://127.0.0.1:4555/hook', dataDir: '/tmp/tc', installed: () => true }
const claude = createClaudeAdapter(shared) as ProviderAdapter
const codex = createCodexAdapter(shared) as ProviderAdapter
const opencode = createOpencodeAdapter(shared) as ProviderAdapter

describe('the shape of a provider session id', () => {
  it('takes what the app and the products this app has met really write', () => {
    for (const id of [
      randomUUID(),
      '11111111-2222-3333-4444-555555555555',
      '019927f1-a0b2-7c3d-8e4f-5a6b7c8d9e0f',
      'ses_5f2b7c1d9a',
      'thr_01JD8Q',
      'a',
      'A'.repeat(128),
    ]) {
      expect(isProviderSessionId(id), id).toBe(true)
    }
  })

  it('refuses an id a CLI parser would read as a flag rather than a value', () => {
    expect(isProviderSessionId('--dangerously-skip-permissions')).toBe(false)
    expect(isProviderSessionId('-p')).toBe(false)
    expect(isProviderSessionId('--resume')).toBe(false)
  })

  it('refuses an id that is also a path', () => {
    expect(isProviderSessionId('../../../../../../Users/boss/.claude')).toBe(false)
    expect(isProviderSessionId('..\\..\\..\\Users\\boss\\.claude')).toBe(false)
    expect(isProviderSessionId('a/b')).toBe(false)
    expect(isProviderSessionId('C:tmp')).toBe(false)
  })

  it('refuses an id that is empty, unbounded, or holds what a shell or a JSON file would read', () => {
    expect(isProviderSessionId('')).toBe(false)
    expect(isProviderSessionId('A'.repeat(129))).toBe(false)
    expect(isProviderSessionId('id with a space')).toBe(false)
    expect(isProviderSessionId('id\nStop')).toBe(false)
    expect(isProviderSessionId('id"}')).toBe(false)
    expect(isProviderSessionId('$(id)')).toBe(false)
  })
})

describe('the session id a hook names', () => {
  it('reads the id out of each product’s own payload', () => {
    expect(hookSessionId(claude, { session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(hookSessionId(codex, { threadId: 'thr-codex-1' })).toBe('thr-codex-1')
    expect(hookSessionId(opencode, { properties: { sessionID: 'ses_opencode_1' } })).toBe('ses_opencode_1')
  })

  it('names no Session at all when the id is not one this app would have written', () => {
    // The Session POSTs its own hooks, so this is a string an Employee chooses (T199-H1).
    expect(hookSessionId(claude, { session_id: '--dangerously-skip-permissions' })).toBeNull()
    expect(hookSessionId(claude, { session_id: '../../../../../../Users/boss/.claude' })).toBeNull()
    expect(hookSessionId(codex, { threadId: '--yolo' })).toBeNull()
    expect(hookSessionId(opencode, { properties: { sessionID: '../../x' } })).toBeNull()
  })

  it('still names no Session for a hook that names none', () => {
    expect(hookSessionId(claude, {})).toBeNull()
    expect(hookSessionId(codex, {})).toBeNull()
    expect(hookSessionId(opencode, {})).toBeNull()
  })
})
