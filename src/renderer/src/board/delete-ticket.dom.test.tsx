import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { Result } from '../../../shared/domain/result'
import type { TinyCorpApi } from '../../../shared/ipc'
import type { TicketRemoval } from '../../../shared/ticket-removal'
import { useTicketDelete } from './DeleteTicket'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const removal: TicketRemoval = {
  ticketId: 142,
  code: 'TC-142',
  title: 'Usage chart with range picker',
  subtasks: 0,
  links: 0,
  worktrees: ['web-app'],
  holder: 'Nova',
}

let root: Root | null = null
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
})

/** The drawer's side of Delete ticket, with the engine answering `asked` and recording deletes. */
function mount(asked: Result<TicketRemoval>) {
  const deleted: number[] = []
  let closed = 0
  window.tinyCorp = {
    board: {
      ticketRemoval: async () => asked,
      deleteTicket: async (ticketId: number) => {
        deleted.push(ticketId)
        return { ok: true, value: removal }
      },
    },
  } as unknown as TinyCorpApi

  function Drawer() {
    const deletion = useTicketDelete(() => closed++)
    return (
      <div>
        <button type="button" onClick={() => deletion.ask(142)}>
          Ask
        </button>
        {deletion.refusal && <p role="alert">{deletion.refusal}</p>}
        {deletion.overlay}
      </div>
    )
  }

  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Drawer />))
  return { deleted, closed: () => closed }
}

const click = (label: string) =>
  act(async () => {
    const button = [...document.querySelectorAll('button')].find((one) => one.textContent === label)
    button?.click()
  })
const dialog = () => document.querySelector('[role="alertdialog"]')

describe('Delete ticket in the drawer (T275, frames eKZNK and xdaOR)', () => {
  it('asks first, naming what goes, and deletes on the boss’s word', async () => {
    const { deleted, closed } = mount({ ok: true, value: removal })

    await click('Ask')

    expect(dialog()?.textContent).toContain('Delete TC-142?')
    expect(dialog()?.textContent).toContain('Its worktree and branch in web-app go too; nothing was done in them.')
    // Cancel holds the focus, so a stray Enter deletes nothing.
    expect(document.activeElement?.textContent).toBe('Cancel')
    expect(deleted).toEqual([])

    await click('Delete ticket')

    expect(deleted).toEqual([142])
    expect(closed()).toBe(1)
    expect(dialog()).toBeNull()
  })

  it('says why a ticket stays, and never opens the confirmation for it', async () => {
    const why = 'TC-142 opened a pull request, so it stays on the board with its history.'
    const { deleted } = mount({ ok: false, error: why })

    await click('Ask')

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(why)
    expect(dialog()).toBeNull()
    expect(deleted).toEqual([])
  })

  it('lets Escape put the confirmation away without deleting', async () => {
    const { deleted, closed } = mount({ ok: true, value: removal })
    await click('Ask')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(dialog()).toBeNull()
    expect(deleted).toEqual([])
    expect(closed()).toBe(0)
  })
})
