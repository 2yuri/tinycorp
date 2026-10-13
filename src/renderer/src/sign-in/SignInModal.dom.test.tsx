import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_CATALOGUE } from '../../../shared/domain/providers'
import type { SignInApi, SignInState } from '../../../shared/usage/sign-in'

/**
 * The sign-in modal as the boss sees it (T263, frames `Tmldc` and `iA8Wm`): opened from anywhere,
 * it starts the product's own login in the main process, follows what the main process says of it,
 * and kills the terminal when it closes. The terminal itself is xterm, which jsdom cannot draw, so
 * it is stubbed at the module's front door and nothing above it.
 */

vi.mock('../terminal', () => ({ PtyScreen: () => <div data-testid="pty-screen" /> }))

const [first] = PROVIDER_CATALOGUE

let host: HTMLDivElement
let root: Root
let emitState: (id: string, state: SignInState) => void
let api: { [K in keyof SignInApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    start: vi.fn(async () => ({
      ok: true,
      value: {
        id: 'run-1',
        provider: first.id,
        sub: 'Personal · runs in WSL · archlinux',
        state: { phase: 'waiting', step: 0 },
      },
    })),
    write: vi.fn(async () => ({ ok: true, value: undefined })),
    resize: vi.fn(async () => ({ ok: true, value: undefined })),
    cancel: vi.fn(async () => ({ ok: true, value: undefined })),
    onData: vi.fn(() => () => {}),
    onState: vi.fn((listener: (id: string, state: SignInState) => void) => {
      emitState = listener
      return () => {}
    }),
  }
  window.tinyCorp = { signIn: api } as unknown as typeof window.tinyCorp
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.resetModules()
})

async function openModal() {
  const { SignInHost, openSignIn } = await import('.')
  act(() => root.render(<SignInHost />))
  await act(async () => openSignIn({ provider: first.id, accountId: 'work' }))
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === text)
  if (!found) throw new Error(`no button ${text}`)
  return found
}

describe('the sign-in modal', () => {
  it('starts the product’s own login for that account and says where it runs', async () => {
    await openModal()

    expect(api.start).toHaveBeenCalledWith({ provider: first.id, accountId: 'work' })
    expect(host.textContent).toContain(`Sign in to ${first.name}`)
    expect(host.textContent).toContain('Personal · runs in WSL · archlinux')
    expect(host.querySelectorAll('li')).toHaveLength(first.auth.signIn.steps.length)
  })

  it('moves to signed in when the main process sees the login, and names who', async () => {
    await openModal()

    act(() => emitState('run-1', { phase: 'signed-in', who: 'boss@example.com · Max 20×' }))

    expect(host.textContent).toContain('Signed in as boss@example.com · Max 20×')
    expect([...host.querySelectorAll('li')].every((step) => step.dataset['mark'] === 'done')).toBe(true)
    act(() => button('Done').click())
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('kills the terminal on Cancel', async () => {
    await openModal()

    act(() => button('Cancel').click())

    expect(api.cancel).toHaveBeenCalledWith('run-1')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
