import { join } from 'node:path'
/**
 * An Employee that stops to ask for permission tells you, and stops telling you once answered
 * (T165).
 *
 * The bug this is written against is one line: the Claude adapter hooked `Notification` with the
 * matcher `idle_prompt`, so the Session's own `permission_prompt` — it stopped, in its terminal,
 * waiting for the boss — never reached the app at all. The Employee looked Working forever.
 *
 * So the tests here follow one ask the whole way: the hook arrives, the Employee is *waiting on
 * you* everywhere the app already says that, the boss is told once, and everything of it goes when
 * the Session moves on. Nothing here ever answers the prompt: the boss does, in the terminal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { traySummary } from '../../../shared/app/tray'
import { askingText, askRowId } from '../../../shared/inbox/boss-inbox'
import type { CompanyNotification } from '../../../shared/notifications'
import { projectOffice } from '../../../shared/office/projection'
import { engineTrayFacts } from '../../app/tray/menu-bar'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'

/** What the ask says the Session is doing, with the target written the way this platform does. */
const WROTE = `Write ${join('src', 'api', 'usage.ts')}`

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

/** Lets a notification that waits for the rest of the current action come out. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function setup() {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const sent: CompanyNotification[] = []
  engine.notifications.onNotify((notification) => void sent.push(notification))
  return { engine, provider, sent }
}

/** An Employee on `Ask first`, with a Session running and a turn under way. */
function working(engine: CompanyEngine, provider: FakeProvider, name = 'Ada') {
  const employee = engine.employees.create({ name, roleId: 'backend', permissionMode: 'interactive' })
  engine.sessions.start(employee.id)
  const session = provider.spawnOf(employee.id)
  session.hook('UserPromptSubmit')
  return { employee, session }
}

/** The Employee's sprite, as the office draws it from the engine's own facts. */
function sprite(engine: CompanyEngine, employeeId: string) {
  const scene = projectOffice({ employees: engine.employees.list(), ...engine.office.facts() })
  return scene.sprites.find((one) => one.employeeId === employeeId)!
}

/** The ask Claude Code 2.1.280 sends when it stops to ask about writing a file. */
const PERMISSION_REQUEST = {
  cwd: onDisk('/work/acme'),
  tool_name: 'Write',
  tool_input: { file_path: onDisk('/work/acme/src/api/usage.ts'), content: 'hello' },
}

describe('A Session that stops to ask the boss', () => {
  it('says what it is asking, and forgets it the moment the Session moves on', () => {
    const { engine, provider } = setup()
    const { employee, session } = working(engine, provider)

    session.hook('PermissionRequest', PERMISSION_REQUEST)

    expect(engine.sessions.get(employee.id).asking).toEqual({
      what: WROTE,
      since: expect.any(String),
    })

    session.hook('PostToolUse', { tool_name: 'Write' })

    expect(engine.sessions.get(employee.id).asking).toBeNull()
  })

  it.each(['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'])('is answered by %s', (event) => {
    const { engine, provider } = setup()
    const { employee, session } = working(engine, provider)
    session.hook('PermissionRequest', PERMISSION_REQUEST)

    session.hook(event, { tool_name: 'Write' })

    expect(engine.sessions.get(employee.id).asking).toBeNull()
  })

  it('stands the Employee at the boss desk with a “!”, and sits them down once it clears', () => {
    const { engine, provider } = setup()
    const { employee, session } = working(engine, provider)

    expect(sprite(engine, employee.id).state).toBe('working')

    session.hook('PermissionRequest', PERMISSION_REQUEST)

    expect(sprite(engine, employee.id)).toMatchObject({
      state: 'waiting',
      reason: 'Waiting on you',
      bubble: '!',
      away: expect.objectContaining({ place: 'boss' }),
    })

    session.hook('PostToolUse', { tool_name: 'Write' })

    expect(sprite(engine, employee.id).state).toBe('working')
  })

  it('counts in the menu bar’s “waiting on you”, beside the Approvals', () => {
    const { engine, provider } = setup()
    const { session } = working(engine, provider)

    expect(traySummary(engineTrayFacts(engine)).waitingOnYou).toBe(0)

    session.hook('PermissionRequest', PERMISSION_REQUEST)

    expect(traySummary(engineTrayFacts(engine))).toMatchObject({ waitingOnYou: 1, atWork: 1 })

    session.hook('Stop')

    expect(traySummary(engineTrayFacts(engine)).waitingOnYou).toBe(0)
  })

  it('opens a row in the boss’s Inbox that resolves itself when the ask is answered', () => {
    const { engine, provider } = setup()
    const { employee, session } = working(engine, provider)

    expect(engine.chat().bossInbox()).toEqual([])

    session.hook('PermissionRequest', PERMISSION_REQUEST)

    expect(engine.chat().bossInbox()).toEqual([
      expect.objectContaining({
        id: askRowId(employee.id),
        kind: 'asking',
        fromId: employee.id,
        text: askingText('Ada', { what: WROTE }),
        unread: true,
      }),
    ])

    session.hook('Stop')

    // Nothing was marked read and nothing was written to chat: the row is simply not true any more.
    expect(engine.chat().bossInbox()).toEqual([])
  })

  it('tells the boss once per ask, however many times the CLI repeats itself', async () => {
    const { engine, provider, sent } = setup()
    const { employee, session } = working(engine, provider)

    // What `claude` 2.1.280 really sends: the permission hook, then its own notification after it.
    session.hook('PermissionRequest', PERMISSION_REQUEST)
    session.hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' })
    session.hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' })
    await settle()

    expect(sent).toEqual([
      {
        companyId: expect.any(String),
        kind: 'asking',
        title: 'Ada is asking you',
        body: askingText('Ada', { what: WROTE }),
        icon: 'AD',
        // Clicking it opens that Employee's drawer, which opens on the Terminal tab.
        focus: { kind: 'employee', employeeId: employee.id },
      },
    ])
  })

  it('rings again for the next ask, once the first one is answered', async () => {
    const { engine, provider, sent } = setup()
    const { session } = working(engine, provider)

    session.hook('PermissionRequest', PERMISSION_REQUEST)
    session.hook('PostToolUse', { tool_name: 'Write' })
    session.hook('PermissionRequest', {
      ...PERMISSION_REQUEST,
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf build' },
    })
    await settle()

    expect(sent.map((one) => one.body)).toEqual([
      askingText('Ada', { what: WROTE }),
      askingText('Ada', { what: 'rm -rf build' }),
    ])
  })

  it('says nothing to a Company that has notifications off', async () => {
    const { engine, provider, sent } = setup()
    const { session } = working(engine, provider)
    engine.notifications.setEnabled(false)

    session.hook('PermissionRequest', PERMISSION_REQUEST)
    await settle()

    expect(sent).toEqual([])
  })

  it('clears the ask when the Session ends, however it ends', () => {
    const { engine, provider } = setup()
    const { employee, session } = working(engine, provider)
    session.hook('PermissionRequest', PERMISSION_REQUEST)

    engine.sessions.stop(employee.id)

    expect(engine.sessions.get(employee.id).asking).toBeNull()
    expect(engine.chat().bossInbox()).toEqual([])
    expect(sprite(engine, employee.id).state).toBe('off')
  })

  it('never answers the prompt: nothing is typed into the Session while it asks', () => {
    const { engine, provider } = setup()
    const { employee, session } = working(engine, provider)
    const before = [...session.pty.written]

    session.hook('PermissionRequest', PERMISSION_REQUEST)

    expect(session.pty.written).toEqual(before)
    // A Session stopped asking is not idle, so nothing the engine queues is pushed into it either.
    expect(engine.sessions.pushPrompt(employee.id, 'y')).toBe(false)
  })
})
