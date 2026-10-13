// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, AttachmentSource, OpenedAttachment } from '../../../shared/attachments'
import type { Message } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { ChatData } from './chat-view'

const ada = { id: 'e-ada', name: 'Ada Byron', title: 'PM', capabilities: [] } as unknown as Employee

const data: ChatData = {
  employees: [ada],
  board: null,
  code: [],
  repos: [],
  approvals: new Map(),
  reviews: [],
  bossName: 'Yuri',
}

const opened = new Map<number, OpenedAttachment>()
const revealed: string[] = []

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  // jsdom has no layout, and the message list scrolls to its end on every render.
  Element.prototype.scrollIntoView = () => {}
  opened.clear()
  revealed.splice(0)
  ;(globalThis as { window?: unknown }).window = globalThis.window
  Object.assign(globalThis.window, {
    tinyCorp: {
      approvals: {},
      chat: {
        attachment: (id: number) =>
          Promise.resolve(opened.has(id) ? { ok: true, value: opened.get(id)! } : { ok: false, error: 'gone' }),
      },
      paths: {
        reveal: (path: string) => {
          revealed.push(path)
          return Promise.resolve({ ok: true, value: undefined })
        },
      },
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return { id: 1, messageId: 1, name: 'run.log', size: 2048, createdAt: '', ...overrides }
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    kind: 'post',
    channelId: 'tech',
    threadId: null,
    authorId: ada.id,
    text: 'here it is',
    mentions: [],
    mentionsChannel: false,
    replyCount: 0,
    createdAt: '2026-09-17T09:12:00',
    ...overrides,
  }
}

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node)
  })
}

/** One message carrying `shot.png`, drawn and ready to click. */
async function withImage(): Promise<void> {
  const { MessageList } = await import('./Messages')
  const shot = attachment({ id: 7, name: 'shot.png', size: 1024 })
  opened.set(7, {
    id: 7,
    name: 'shot.png',
    size: 1024,
    dataUrl: 'data:image/png;base64,AAA',
    path: '/c/a/1/shot.png',
  })
  await render(
    <MessageList
      messages={[message({ attachments: [shot] })]}
      data={data}
      people={[{ id: ada.id, name: ada.name }]}
      refs={{ tickets: [], channelIds: ['tech'], companyKey: 'TC', onChannel: () => {} }}
      activeThread={null}
      onOpenThread={() => {}}
    />,
  )
}

describe('The files a message carries', () => {
  it('draws an image inline and everything else as a chip', async () => {
    const { MessageList } = await import('./Messages')
    const shot = attachment({ id: 7, name: 'shot.png', size: 1024 })
    const log = attachment({ id: 8, name: 'run.log' })
    opened.set(7, {
      id: 7,
      name: 'shot.png',
      size: 1024,
      dataUrl: 'data:image/png;base64,AAA',
      path: '/c/a/1/shot.png',
    })
    opened.set(8, { id: 8, name: 'run.log', size: 2048, dataUrl: null, path: '/c/a/1/run.log' })

    await render(
      <MessageList
        messages={[message({ attachments: [shot, log] })]}
        data={data}
        people={[{ id: ada.id, name: ada.name }]}
        refs={{ tickets: [], channelIds: ['tech'], companyKey: 'TC', onChannel: () => {} }}
        activeThread={null}
        onOpenThread={() => {}}
      />,
    )

    const image = host.querySelector('img')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,AAA')
    expect(image?.getAttribute('alt')).toBe('shot.png')
    const chips = [...host.querySelectorAll('[data-attachment-chip]')].map((c) => c.textContent)
    expect(chips).toEqual(['run.log2.0 KB'])
  })

  it('hands the file to Finder when the boss clicks it', async () => {
    const { MessageList } = await import('./Messages')
    opened.set(1, { id: 1, name: 'run.log', size: 2048, dataUrl: null, path: '/c/a/1/run.log' })

    await render(
      <MessageList
        messages={[message({ attachments: [attachment()] })]}
        data={data}
        people={[{ id: ada.id, name: ada.name }]}
        refs={{ tickets: [], channelIds: ['tech'], companyKey: 'TC', onChannel: () => {} }}
        activeThread={null}
        onOpenThread={() => {}}
      />,
    )
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-attachment-chip]')!.click()
    })

    expect(revealed).toEqual(['/c/a/1/run.log'])
  })

  it('opens the lightbox when the thumbnail is clicked, and closes it on Esc (T236)', async () => {
    await withImage()
    const thumbnail = host.querySelector<HTMLButtonElement>('[data-ui="Image thumbnail"]')!
    expect(thumbnail.getAttribute('aria-label')).toBe('Open shot.png')
    expect(document.body.querySelector('[data-ui="Lightbox"]')).toBeNull()

    await act(async () => {
      thumbnail.click()
    })
    const box = document.body.querySelector('[data-ui="Lightbox"]')!
    expect(box.getAttribute('role')).toBe('dialog')
    expect(box.textContent).toContain('shot.png')
    expect(box.textContent).toContain('1.0 KB')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(document.body.querySelector('[data-ui="Lightbox"]')).toBeNull()
  })

  it('closes the lightbox on a click outside, and keeps it on a click on the picture', async () => {
    await withImage()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-ui="Image thumbnail"]')!.click()
    })

    // The picture itself is not a way out: a click on it bubbles no further than its own box.
    await act(async () => {
      document.body.querySelector('[data-ui="Lightbox"] img')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.body.querySelector('[data-ui="Lightbox"]')).not.toBeNull()

    await act(async () => {
      document.body.querySelector('[data-ui="Lightbox"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.body.querySelector('[data-ui="Lightbox"]')).toBeNull()
  })

  it('reveals the file from the lightbox, which is the only place that offers it now', async () => {
    await withImage()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-ui="Image thumbnail"]')!.click()
    })
    await act(async () => {
      ;[...document.body.querySelectorAll<HTMLButtonElement>('[data-ui="Lightbox"] button')]
        .find((one) => one.textContent?.includes('Reveal in Finder'))!
        .click()
    })

    expect(revealed).toEqual(['/c/a/1/shot.png'])
  })

  it('falls back to a chip for an image the main process cannot read', async () => {
    const { MessageList } = await import('./Messages')

    await render(
      <MessageList
        messages={[message({ attachments: [attachment({ name: 'gone.png' })] })]}
        data={data}
        people={[{ id: ada.id, name: ada.name }]}
        refs={{ tickets: [], channelIds: ['tech'], companyKey: 'TC', onChannel: () => {} }}
        activeThread={null}
        onOpenThread={() => {}}
      />,
    )

    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('[data-attachment-chip]')?.textContent).toContain('gone.png')
  })
})

describe('The composer’s paperclip', () => {
  /** What a file picker and a drop both hand the composer. */
  function file(name: string, contents: string): File {
    return new File([contents], name, { type: 'text/plain' })
  }

  async function composer(onSend: (text: string, attachments: AttachmentSource[]) => Promise<boolean>) {
    const { Composer } = await import('./Composer')
    await render(
      <Composer
        variant="main"
        placeholder="Set a goal for the team…"
        people={[{ id: ada.id, name: ada.name }]}
        refs={{ tickets: [], channelIds: ['tech'], companyKey: 'TC', onChannel: () => {} }}
        onSend={onSend}
      />,
    )
  }

  it('opens the file picker, which is no longer inert', async () => {
    await composer(() => Promise.resolve(true))
    const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!
    const clicked = vi.spyOn(picker, 'click')

    const paperclip = host.querySelector<HTMLButtonElement>('button[aria-label="Attach a file"]')!
    expect(paperclip.disabled).toBe(false)
    await act(async () => {
      paperclip.click()
    })

    expect(clicked).toHaveBeenCalled()
  })

  it('holds what was dropped on it as a chip, and sends its bytes with the message', async () => {
    const sent: { text: string; attachments: AttachmentSource[] }[] = []
    await composer((text, attachments) => {
      sent.push({ text, attachments })
      return Promise.resolve(true)
    })

    await act(async () => {
      const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: unknown }
      event.dataTransfer = { files: [file('run.log', 'two failures')] }
      host.querySelector('form')!.dispatchEvent(event)
    })
    expect(host.querySelector('[data-attachment-chip]')?.textContent).toContain('run.log')

    const box = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => {
      nativeValue(box, 'the failing run')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toBe('the failing run')
    expect(sent[0]!.attachments.map(described)).toEqual([{ name: 'run.log', text: 'two failures' }])
    // The chip goes once the message is away.
    expect(host.querySelector('[data-attachment-chip]')).toBeNull()
  })

  it('takes a file off again before it is sent', async () => {
    await composer(() => Promise.resolve(true))
    await act(async () => {
      const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: unknown }
      event.dataTransfer = { files: [file('run.log', 'x')] }
      host.querySelector('form')!.dispatchEvent(event)
    })

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Remove run.log"]')!.click()
    })

    expect(host.querySelector('[data-attachment-chip]')).toBeNull()
  })

  it('sends a file with no words at all', async () => {
    const sent: AttachmentSource[][] = []
    await composer((_text, attachments) => {
      sent.push(attachments)
      return Promise.resolve(true)
    })

    await act(async () => {
      const event = new Event('drop', { bubbles: true }) as Event & { dataTransfer: unknown }
      event.dataTransfer = { files: [file('shot.png', 'png')] }
      host.querySelector('form')!.dispatchEvent(event)
    })
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(sent.map((one) => one.map(described))).toEqual([[{ name: 'shot.png', text: 'png' }]])
  })
})

/** A source as this test reads it: the name, and the bytes as the text they were written from. */
function described(source: AttachmentSource): { name: string; text: string } {
  if (!('data' in source)) throw new Error('The composer sends bytes, never a path')
  return { name: source.name, text: new TextDecoder().decode(source.data) }
}

/** React listens to the native setter, so a test types through it rather than assigning. */
function nativeValue(input: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
}
