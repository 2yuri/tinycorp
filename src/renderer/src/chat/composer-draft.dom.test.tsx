import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentSource } from '../../../shared/attachments'
import { type Draft, type DraftKey, isEmptyDraft } from '../../../shared/drafts'
import type { ChatApi } from '../../../shared/ipc'
import { Composer } from './Composer'
import { DRAFT_SAVE_DELAY } from './composer-draft'
import type { Refs } from './Messages'

const refs: Refs = { tickets: [], channelIds: [], companyKey: 'TC', onChannel: () => {} }

/** The drafts the main process keeps, and the files on "disk" a draft can point at. */
let kept: Map<string, Draft>
let disk: Map<string, string>
let host: HTMLDivElement
let root: Root
let sent: { text: string; attachments: AttachmentSource[] }[]
const bridge = window as unknown as { tinyCorp: { chat?: Partial<ChatApi> } }

beforeEach(() => {
  kept = new Map()
  disk = new Map()
  sent = []
  bridge.tinyCorp.chat = {
    draft: async (key) => ({ ok: true, value: kept.get(key) ?? null }),
    saveDraft: async (key, draft) => {
      if (isEmptyDraft(draft)) kept.delete(key)
      else kept.set(key, draft)
      return { ok: true, value: null }
    },
    clearDraft: async (key) => {
      kept.delete(key)
      return { ok: true, value: null }
    },
    draftFile: async (key, path) => {
      const contents = disk.get(path)
      if (!kept.get(key)?.files.some((f) => f.path === path) || contents === undefined)
        return { ok: false, error: 'That file is not in the draft' }
      return { ok: true, value: { name: path.split('/').pop()!, data: new TextEncoder().encode(contents) } }
    },
    pathOf: (file) => `/desktop/${file.name}`,
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete bridge.tinyCorp.chat
  vi.useRealTimers()
})

async function mount(draftKey: DraftKey | undefined, onSend = async () => true) {
  await act(async () =>
    root.render(
      <Composer
        key={draftKey ?? 'none'}
        variant="main"
        placeholder="Message #tech…"
        people={[]}
        refs={refs}
        draftKey={draftKey}
        onSend={async (text, attachments) => {
          sent.push({ text, attachments })
          return onSend()
        }}
      />,
    ),
  )
}

const box = () => host.querySelector('textarea')!
const chips = () => [...host.querySelectorAll('[data-attachment-chip]')].map((chip) => chip.textContent)

async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box(), text)
    box().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function send() {
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

async function drop(name: string, contents: string) {
  await act(async () => {
    const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: unknown }
    event.dataTransfer = { files: [new File([contents], name, { type: 'text/plain' })] }
    host.querySelector('form')!.dispatchEvent(event)
  })
}

async function paste(files: File[], text = '') {
  let defaulted = true
  await act(async () => {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
    event.clipboardData = { files, getData: () => text }
    box().dispatchEvent(event)
    defaulted = !event.defaultPrevented
  })
  return defaulted
}

async function leave() {
  await act(async () => root.render(null))
}

describe('a composer’s draft (TI-1)', () => {
  it('comes back with its text and files when the boss returns', async () => {
    disk.set('/desktop/run.log', 'two failures')
    kept.set('channel:tech', { text: 'see the log', files: [{ path: '/desktop/run.log', name: 'run.log', size: 12 }] })

    await mount('channel:tech')

    expect(box().value).toBe('see the log')
    expect(chips()).toEqual([expect.stringContaining('run.log')])
  })

  it('is kept a moment after the last keystroke, and once more on leaving', async () => {
    vi.useFakeTimers()
    await mount('channel:tech')

    await type('half a')
    expect(kept.get('channel:tech')).toBeUndefined()
    await act(async () => vi.advanceTimersByTime(DRAFT_SAVE_DELAY))
    expect(kept.get('channel:tech')?.text).toBe('half a')

    await type('half a thought')
    await leave()
    expect(kept.get('channel:tech')?.text).toBe('half a thought')
  })

  it('keeps a dropped file by its path, not its bytes', async () => {
    await mount('desk')
    await drop('run.log', 'two failures')
    await leave()

    expect(kept.get('desk')).toEqual({ text: '', files: [{ path: '/desktop/run.log', name: 'run.log', size: 12 }] })
  })

  it('keeps each conversation apart', async () => {
    await mount('channel:tech')
    await type('for tech')
    await mount('channel:general')

    expect(box().value).toBe('')
    expect(kept.get('channel:tech')?.text).toBe('for tech')
  })

  it('goes once the message is sent, and a restored file is sent from where it is', async () => {
    disk.set('/desktop/run.log', 'two failures')
    kept.set('channel:tech', { text: 'see the log', files: [{ path: '/desktop/run.log', name: 'run.log', size: 12 }] })
    await mount('channel:tech')

    await send()

    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toBe('see the log')
    expect(
      sent[0]!.attachments.map((a) => ({ name: a.name, text: 'data' in a && new TextDecoder().decode(a.data) })),
    ).toEqual([{ name: 'run.log', text: 'two failures' }])
    expect(kept.has('channel:tech')).toBe(false)
    expect(box().value).toBe('')
  })

  it('stays when the send fails', async () => {
    await mount('channel:tech', async () => false)
    await type('try again')
    await send()
    await leave()

    expect(kept.get('channel:tech')?.text).toBe('try again')
  })

  it('never overwrites what the boss typed before the draft loaded', async () => {
    let answer: (value: { ok: true; value: Draft }) => void = () => {}
    bridge.tinyCorp.chat!.draft = () => new Promise((resolve) => (answer = resolve))
    await mount('channel:tech')

    await type('typed first')
    await act(async () => answer({ ok: true, value: { text: 'older draft', files: [] } }))

    expect(box().value).toBe('typed first')
  })

  it('keeps what was typed before the kept draft had even loaded', async () => {
    // The one way out of a composer that is not the timer: open a conversation, type, leave at once.
    let answer: (value: { ok: true; value: Draft | null }) => void = () => {}
    bridge.tinyCorp.chat!.draft = () => new Promise((resolve) => (answer = resolve))
    await mount('channel:tech')
    await type('straight back out')

    await leave()
    await act(async () => answer({ ok: true, value: null }))

    expect(kept.get('channel:tech')?.text).toBe('straight back out')
  })

  it('keeps nothing without a key, as in the review composers', async () => {
    await mount(undefined)
    await type('a line comment')
    await leave()

    expect(kept.size).toBe(0)
  })
})

// Ctrl+V and Cmd+V attached nothing: the composer held a drop and the picker, and a paste only ever
// reached the box as text, so a screenshot on the clipboard went nowhere.
describe('a paste into the composer', () => {
  it('holds a pasted screenshot as an attachment, named for when it came in', async () => {
    await mount(undefined)

    const typedByTheBox = await paste([new File(['png'], 'image.png', { type: 'image/png' })])

    expect(typedByTheBox).toBe(false)
    expect(chips()).toHaveLength(1)
    expect(chips()[0]).toMatch(/Pasted image \d\d\.\d\d\.\d\d\.png/)
  })

  it('keeps the name of a file copied in the OS', async () => {
    await mount(undefined)

    await paste([new File(['two failures'], 'run.log', { type: 'text/plain' })])

    expect(chips()[0]).toContain('run.log')
  })

  it('leaves plain text to the box, so Ctrl+V still types it', async () => {
    await mount(undefined)

    const typedByTheBox = await paste([], 'hello')

    expect(typedByTheBox).toBe(true)
    expect(chips()).toHaveLength(0)
  })
})
