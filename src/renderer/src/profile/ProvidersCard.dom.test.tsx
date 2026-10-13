// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDERS } from '../../../shared/domain/providers'
import type { AccountRow } from '../../../shared/usage/provider-accounts'
import type { SignInRequest } from '../../../shared/usage/sign-in'
import { onOpenSignIn } from '../sign-in'
import { ACCOUNT_NAME, ADD_ACCOUNT, DEFAULT_ACCOUNT, ProvidersCardBody, SIGN_IN } from './ProvidersCard'
import type { ProviderRowView } from './providers-card'

/**
 * The card as the boss sees it (frames `Oykzs`, `A2lOk0`): a box per Provider, the sign-ins listed
 * under the one whose CLI holds more than one, and the place it runs in behind its chip.
 *
 * `providers-card.test.ts` holds what each row *says*; this is what the screen *draws* — the shape
 * the frame was redrawn into, which the T173 card did not have.
 */

const [first, second] = PROVIDERS

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function draw(rows: ProviderRowView[], onPick?: (provider: string, runtime: string) => void) {
  act(() => root.render(<ProvidersCardBody rows={rows} onPick={onPick} />))
}

function row(over: Partial<ProviderRowView> = {}): ProviderRowView {
  return {
    id: first!,
    title: 'Product',
    detail: '',
    detailIsAddress: false,
    detailNote: '',
    badge: 'Connected',
    tone: 'ok',
    idle: false,
    accounts: null,
    runsIn: null,
    ...over,
  }
}

function account(over: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-personal',
    provider: first!,
    label: 'Personal',
    plan: 'Max 20×',
    email: 'boss@example.com',
    configDir: '/config',
    isDefault: true,
    primary: true,
    window: { key: 'five_hour', label: '5h', percent: 15, resetsAt: null },
    outOfBudget: false,
    reason: null,
    ...over,
  }
}

describe('the Providers card', () => {
  it('draws one box per Provider, and the sign-ins inside the box that holds them', () => {
    draw([
      row({
        accounts: [
          account(),
          account({
            id: 'acc-work',
            label: 'Work',
            plan: 'Team',
            isDefault: false,
            primary: false,
            window: null,
            reason: 'read from its own Session',
          }),
        ],
      }),
      row({ id: second!, title: 'Other', detail: 'boss@example.com', detailIsAddress: true }),
    ])

    expect(host.querySelectorAll('[data-provider]')).toHaveLength(2)
    // The sign-ins live inside their Provider's box, not beside it.
    const boxes = [...host.querySelectorAll('[data-provider]')]
    expect(boxes[0]!.querySelectorAll('[data-ui="Account"]')).toHaveLength(2)
    expect(boxes[1]!.querySelectorAll('[data-ui="Account"]')).toHaveLength(0)
    expect(host.textContent).toContain('Personal · Max 20×')
    expect(host.textContent).toContain(DEFAULT_ACCOUNT)
    expect(host.textContent).toContain(ADD_ACCOUNT)
  })

  it('carries a bar per sign-in, empty where the numbers would come from that sign-in itself', () => {
    draw([
      row({
        accounts: [
          account(),
          account({
            id: 'acc-work',
            label: 'Work',
            isDefault: false,
            primary: false,
            window: null,
            reason: 'read from its own Session',
          }),
        ],
      }),
    ])

    const bars = [...host.querySelectorAll<HTMLElement>('[data-ui="Account"] [data-slot=progress-bar]')]
    expect(bars.map((bar) => bar.style.width)).toEqual(['15%', '0%'])
    // Never a percentage nobody measured: the second row says so in words instead.
    expect(host.textContent).toContain('usage not read')
    expect(host.querySelectorAll('[data-ui="Account Meter"]')[1]?.getAttribute('title')).toBe(
      'read from its own Session',
    )
  })

  it('names the place a CLI runs as a chip, and opens the others only where there is a choice', () => {
    const pick = vi.fn()
    draw(
      [
        row({
          runsIn: {
            options: [
              { key: 'wsl:Ubuntu', label: 'WSL · Ubuntu', selected: true },
              { key: 'windows', label: 'Windows', selected: false },
            ],
            choosable: true,
            help: 'Found in both.',
            note: '',
          },
        }),
        row({
          id: second!,
          runsIn: {
            options: [{ key: 'windows', label: 'Windows', selected: true }],
            choosable: false,
            help: '',
            note: '',
          },
        }),
      ],
      pick,
    )

    // The one place is a chip and nothing else; the two places are the same chip, as a button.
    const chips = [...host.querySelectorAll('[data-ui="Runtime Chip"]')]
    expect(chips.map((chip) => chip.tagName)).toEqual(['BUTTON', 'SPAN'])
    expect(chips[0]!.textContent).toBe('WSL · Ubuntu')

    act(() => (chips[0] as HTMLButtonElement).click())
    const items = [...host.querySelectorAll('[role="menu"] [data-slot=menu-item]')]
    expect(items.map((item) => item.textContent)).toEqual(['WSL · Ubuntu', 'Windows'])

    act(() => (items[1] as HTMLButtonElement).click())
    expect(pick).toHaveBeenCalledWith(first, 'windows')
  })

  it('draws no empty line under a Provider that named no account', () => {
    draw([row({ detail: '' })])

    expect(host.querySelectorAll('[data-ui="Provider Detail"]')).toHaveLength(0)
  })

  /** Every account has a name the boss gave it, asked for before its sign-in opens (T263). */
  it('asks a new account’s name first, adds it under that name, and opens its sign-in', async () => {
    const addAccount = vi.fn(async (_provider: string, label: string) => ({
      ok: true as const,
      value: { accounts: [account(), account({ id: 'acc-new', label, primary: false, isDefault: false })] },
    }))
    window.tinyCorp = { routing: { addAccount } } as unknown as typeof window.tinyCorp
    const opened: SignInRequest[] = []
    const stop = onOpenSignIn((request) => opened.push(request))
    draw([row({ accounts: [account()] })])

    act(() => button(ADD_ACCOUNT).click())
    const label = [...host.querySelectorAll('label')].find((one) => one.textContent === ACCOUNT_NAME)!
    const name = host.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`)!
    expect(name.value).toBe('Work')
    act(() => type(name, 'Side project'))
    await act(async () => button(SIGN_IN).click())

    expect(addAccount).toHaveBeenCalledWith(first, 'Side project')
    expect(opened).toEqual([{ provider: first, accountId: 'acc-new' }])
    stop()
  })

  it('renames any account, the first one included, from its menu', () => {
    const renameAccount = vi.fn(async () => ({ ok: true as const, value: {} }))
    window.tinyCorp = { routing: { renameAccount } } as unknown as typeof window.tinyCorp
    draw([row({ accounts: [account()] })])

    act(() => button('More for Personal').click())
    act(() => button('Rename…').click())
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Rename Personal"]')!
    act(() => type(field, 'Home'))
    act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

    expect(renameAccount).toHaveBeenCalledWith('acc-personal', 'Home')
  })
})

/** The button whose name or text is `name`. */
function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')].find(
    (one) => one.getAttribute('aria-label') === name || one.textContent?.trim() === name,
  )
  if (!found) throw new Error(`no button ${name}`)
  return found
}

/** Types into a React-controlled field the way the browser does. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
