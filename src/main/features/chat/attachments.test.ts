import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ATTACHMENT_LIMITS } from '../../../shared/attachments'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'

const engines: CompanyEngine[] = []
const scratch: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'attachments-')))
  scratch.push(dir)
  return dir
}

/** A Company on disk, with an Employee, so a post has a real folder to put files in. */
function setup(options: { folder?: string; maxBytes?: number; extensions?: string[] } = {}) {
  const folder = options.folder ?? join(root(), 'acme')
  mkdirSync(folder, { recursive: true })
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    attachments: {
      maxBytes: options.maxBytes ?? DEFAULT_ATTACHMENT_LIMITS.maxBytes,
      extensions: options.extensions ?? DEFAULT_ATTACHMENT_LIMITS.extensions,
    },
  })
  engines.push(engine)
  engine.createCompany({ folder })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  return { engine, folder, ada }
}

/** A file somewhere outside the Company, as the boss's Desktop would hold it. */
function file(name: string, contents = 'x'): string {
  const path = join(root(), name)
  writeFileSync(path, contents)
  return path
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

describe('Chat attachments', () => {
  it('stores a file under the Company folder, by the message that carries it', () => {
    const { engine, folder, ada } = setup()

    const message = engine.chat().post({
      authorId: ada.id,
      channelId: 'tech',
      text: 'the counter is off by one',
      attachments: [{ path: file('screenshot.png', 'png-bytes') }],
    })

    expect(message.attachments).toEqual([
      expect.objectContaining({ messageId: message.id, name: 'screenshot.png', size: 9 }),
    ])
    const stored = join(folder, 'attachments', String(message.id), 'screenshot.png')
    expect(readFileSync(stored, 'utf8')).toBe('png-bytes')
    expect(engine.chat().attachmentPath(message.attachments![0]!.id)).toBe(stored)
  })

  it('gives them back with the message, and leaves a message without them alone', () => {
    const { engine, ada } = setup()
    const chat = engine.chat()
    chat.post({ authorId: ada.id, channelId: 'tech', text: 'nothing attached' })
    chat.post({
      authorId: BOSS,
      channelId: 'tech',
      text: 'here is the log',
      attachments: [{ path: file('run.log', 'boom') }],
    })

    const [plain, withFile] = chat.read({ channelId: 'tech' })

    expect(plain).not.toHaveProperty('attachments')
    expect(withFile!.attachments).toEqual([expect.objectContaining({ name: 'run.log', size: 4 })])
  })

  it('carries them on a thread reply too', () => {
    const { engine, ada } = setup()
    const chat = engine.chat()
    const root = chat.post({ authorId: BOSS, channelId: 'tech', text: 'what did the run say?' })

    const reply = chat.reply({
      authorId: ada.id,
      messageId: root.id,
      text: 'this',
      attachments: [{ path: file('tail.log', 'lines') }],
    })

    expect(reply.attachments).toEqual([expect.objectContaining({ name: 'tail.log' })])
    expect(chat.read({ channelId: 'tech', threadId: root.id }).at(-1)!.attachments).toHaveLength(1)
  })

  it('takes bytes from the composer as well as a path', () => {
    const { engine, folder } = setup()

    const message = engine.chat().post({
      authorId: BOSS,
      channelId: 'tech',
      text: 'dropped this in',
      attachments: [{ name: 'notes.md', data: new TextEncoder().encode('# notes\n') }],
    })

    expect(readFileSync(join(folder, 'attachments', String(message.id), 'notes.md'), 'utf8')).toBe('# notes\n')
  })

  it('lets a screenshot stand on its own, with no words at all', () => {
    const { engine, ada } = setup()

    const message = engine.chat().post({
      authorId: ada.id,
      channelId: 'tech',
      text: '',
      attachments: [{ path: file('shot.png', 'png') }],
    })

    expect(message.text).toBe('')
    expect(message.attachments).toHaveLength(1)
    expect(() => engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '   ' })).toThrow(
      /A message cannot be empty/,
    )
  })

  it('refuses a file over the size limit, and posts nothing at all', () => {
    const { engine, ada } = setup({ maxBytes: 8 })

    expect(() =>
      engine.chat().post({
        authorId: ada.id,
        channelId: 'tech',
        text: 'the whole log',
        attachments: [{ path: file('big.log', 'far too many bytes') }],
      }),
    ).toThrow(/big\.log is 18 bytes, over the 8 bytes/)
    expect(engine.chat().read({ channelId: 'tech' })).toEqual([])
  })

  it('refuses a kind of file that is not allowed, and posts nothing at all', () => {
    const { engine, ada } = setup({ extensions: ['png', 'log'] })

    expect(() =>
      engine.chat().post({
        authorId: ada.id,
        channelId: 'tech',
        text: 'run this',
        attachments: [{ path: file('install.sh', '#!/bin/sh\n') }],
      }),
    ).toThrow(/install\.sh is not a kind of file you can attach \(png, log\)/)
    expect(engine.chat().read({ channelId: 'tech' })).toEqual([])
  })

  it('refuses a file that is not there, and posts nothing at all', () => {
    const { engine, ada } = setup()

    expect(() =>
      engine.chat().post({
        authorId: ada.id,
        channelId: 'tech',
        text: 'here',
        attachments: [{ path: onDisk('/nowhere/shot.png') }],
      }),
    ).toThrow(`There is no file at ${onDisk('/nowhere/shot.png')}`)
    expect(engine.chat().read({ channelId: 'tech' })).toEqual([])
  })

  it('keeps two files of the same name apart inside one message', () => {
    const { engine, folder, ada } = setup()
    const one = join(root(), 'a')
    const two = join(root(), 'b')
    mkdirSync(one)
    mkdirSync(two)
    writeFileSync(join(one, 'shot.png'), 'first')
    writeFileSync(join(two, 'shot.png'), 'second')

    const message = engine.chat().post({
      authorId: ada.id,
      channelId: 'tech',
      text: 'before and after',
      attachments: [{ path: join(one, 'shot.png') }, { path: join(two, 'shot.png') }],
    })

    expect(message.attachments!.map((a) => a.name)).toEqual(['shot.png', 'shot-2.png'])
    const into = join(folder, 'attachments', String(message.id))
    expect(readFileSync(join(into, 'shot.png'), 'utf8')).toBe('first')
    expect(readFileSync(join(into, 'shot-2.png'), 'utf8')).toBe('second')
  })

  it('never lets a name climb out of the message folder', () => {
    const { engine, folder, ada } = setup()

    const message = engine.chat().post({
      authorId: ada.id,
      channelId: 'tech',
      text: 'careful',
      attachments: [{ name: '../../escaped.png', data: new Uint8Array([1]) }],
    })

    expect(message.attachments![0]!.name).toBe('escaped.png')
    expect(existsSync(join(folder, 'attachments', String(message.id), 'escaped.png'))).toBe(true)
  })

  it('opens an image as a data URL and anything else as a path alone', () => {
    const { engine, ada } = setup()
    const message = engine.chat().post({
      authorId: ada.id,
      channelId: 'tech',
      text: 'both',
      attachments: [{ path: file('shot.png', 'png') }, { path: file('run.log', 'lines') }],
    })
    const [image, log] = message.attachments!

    expect(engine.chat().openAttachment(image!.id)).toMatchObject({
      name: 'shot.png',
      dataUrl: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
    })
    expect(engine.chat().openAttachment(log!.id)).toMatchObject({ name: 'run.log', dataUrl: null })
  })

  it('takes the files with the channel when the boss deletes it', () => {
    const { engine, folder, ada } = setup()
    const chat = engine.chat()
    const epic = engine.board().createEpic({ title: 'Billing' })
    const channelId = `epic-${epic.id}-billing`
    const message = chat.post({
      authorId: ada.id,
      channelId,
      text: 'the mock',
      attachments: [{ path: file('mock.png', 'png') }],
    })
    const stored = join(folder, 'attachments', String(message.id))
    expect(existsSync(stored)).toBe(true)

    chat.deleteChannel(channelId)

    expect(existsSync(stored)).toBe(false)
    expect(() => chat.openAttachment(message.attachments![0]!.id)).toThrow(/There is no attachment/)
  })

  it('keeps the store out of the repo when the Company folder sits in a worktree', () => {
    const base = root()
    const repo = join(base, 'app')
    execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' })
    writeFileSync(join(repo, 'README.md'), '# app\n')
    git(repo, 'add', '.')
    git(repo, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-m', 'init')
    const worktree = join(base, 'wt')
    git(repo, 'worktree', 'add', worktree, '-b', 'ticket-1')
    const { engine, ada } = setup({ folder: join(worktree, 'company') })

    engine.chat().post({
      authorId: ada.id,
      channelId: 'tech',
      text: 'the failing run',
      attachments: [{ path: file('run.log', 'boom') }],
    })

    // `info/exclude` lives in the repo's common git dir, which every worktree of it shares.
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude).toContain('/company/attachments/')
    expect(git(worktree, 'status', '--porcelain', '--untracked-files=all')).not.toContain('attachments')
  })
})
