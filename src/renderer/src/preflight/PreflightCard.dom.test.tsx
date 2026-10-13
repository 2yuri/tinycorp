import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROVIDERS } from '../../../shared/domain/providers'
import { PREFLIGHT_STILL_OPENS, type PreflightState, type ProviderPreflight } from '../../../shared/providers/preflight'
import type { SignInRequest } from '../../../shared/usage/sign-in'
import { onOpenSignIn } from '../sign-in'
import { PreflightCard } from './PreflightCard'

/**
 * The card offers the sign-in modal where signing in is the fix (T263): a CLI that is here and
 * signed out, or signed in on a billed key — and not one that is not installed yet.
 */

const [first] = PROVIDERS

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

function check(state: PreflightState): ProviderPreflight {
  return {
    provider: first!,
    state,
    checkedAt: '2026-09-25T09:00:00.000Z',
    hired: true,
    title: 'Not signed in',
    body: 'Nothing here can run an Employee.',
    lead: '',
    commands: [],
    note: PREFLIGHT_STILL_OPENS,
    account: null,
    plan: null,
  }
}

const signIn = () => [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === 'Sign in')

describe('the preflight card', () => {
  it('opens the sign-in modal on the Provider’s own sign-in when it is signed out', () => {
    const opened: SignInRequest[] = []
    const stop = onOpenSignIn((request) => opened.push(request))
    act(() => root.render(<PreflightCard check={check('signed-out')} checking={false} onRecheck={() => {}} />))

    act(() => signIn()!.click())

    expect(opened).toEqual([{ provider: first, accountId: null }])
    stop()
  })

  it('offers no sign-in for a CLI that is not installed', () => {
    act(() => root.render(<PreflightCard check={check('missing')} checking={false} onRecheck={() => {}} />))
    expect(signIn()).toBeUndefined()
  })
})
