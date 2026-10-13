import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ChannelRemoval } from '../../../shared/channel-removal'

let DeleteChannelDialog: typeof import('./DeleteChannel').DeleteChannelDialog

beforeAll(async () => {
  // The module reads the preload API when it loads; static rendering never calls it.
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { chat: {} } }
  ;({ DeleteChannelDialog } = await import('./DeleteChannel'))
})

const noop = () => {}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const removal: ChannelRemoval = {
  channelId: 'epic-4-checkout',
  name: 'epic-4-checkout',
  messages: 12,
  epicId: 4,
}

function dialog(patch: Partial<ChannelRemoval> = {}) {
  return renderToStaticMarkup(
    <DeleteChannelDialog
      removal={{ ...removal, ...patch }}
      busy={false}
      error={null}
      onCancel={noop}
      onConfirm={noop}
    />,
  )
}

describe('The delete channel confirmation (T112)', () => {
  it('names the channel and how many messages go with it', () => {
    const html = dialog()

    expect(text(html)).toContain('Delete #epic-4-checkout?')
    expect(text(html)).toContain('#epic-4-checkout and its 12 messages')
  })

  it('counts one message as one, and none as none yet', () => {
    expect(text(dialog({ messages: 1 }))).toContain('its 1 message')
    expect(text(dialog({ messages: 0 }))).toContain('no messages yet')
  })

  it('says the epic keeps going, and that this cannot be undone', () => {
    expect(text(dialog())).toContain('Epic 4 keeps its tickets')
    expect(text(dialog())).toContain('cannot be undone')
    expect(text(dialog({ epicId: null }))).not.toContain('Epic')
  })

  it('is an alert dialog whose Cancel comes before the destructive Delete channel', () => {
    const html = dialog()

    expect(html).toContain('role="alertdialog"')
    expect(text(html)).toMatch(/Cancel Delete channel$/)
    expect(html).toMatch(/data-variant="destructive"/)
  })
})
