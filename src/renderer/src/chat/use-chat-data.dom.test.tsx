// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repos/repo'
import { useChatData } from './use-chat-data'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * What the Chat view reads about the Company (T212).
 *
 * The repos were read again on `staff.onChanged` and `code.onChanged` and never on
 * `repos.onChanged`, so a repo added or renamed from the Repositories screen did not reach the
 * `#repo` chips or `/ticket`'s completions until somebody happened to be hired.
 */

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const never = () => () => {}
const repo = (name: string) => ({ id: name, name, path: `/work/${name}` }) as unknown as Repo

let repos: Repo[]
let listeners: Record<'repos' | 'staff', (() => void)[]>
let read: ReturnType<typeof vi.fn>

function on(area: 'repos' | 'staff') {
  return (listener: () => void) => {
    listeners[area].push(listener)
    return () => {
      listeners[area].splice(listeners[area].indexOf(listener), 1)
    }
  }
}

const fire = (area: 'repos' | 'staff') =>
  act(async () => {
    for (const listener of listeners[area]) listener()
  })

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  repos = [repo('billing-api')]
  listeners = { repos: [], staff: [] }
  read = vi.fn(() => ok(repos))
  window.tinyCorp = {
    staff: { employees: () => ok([]), onChanged: on('staff') },
    repos: { list: read, onChanged: on('repos') },
    board: { snapshot: () => Promise.resolve(null), onChanged: never },
    code: { list: () => ok([]), onChanged: never },
    reviews: { list: () => ok([]), threads: () => ok([]), onChanged: never },
    planning: { list: () => ok([]), onChanged: never },
    tests: { list: () => ok([]), onChanged: never },
    approvals: { list: () => ok([]), onChanged: never },
    answerer: { get: () => ok({ answererId: null, waitingForId: null }), onChanged: never },
    digest: { schedule: () => ok({ timezone: null }), onChanged: never },
    company: { current: () => Promise.resolve(null), onChanged: never },
  } as unknown as typeof window.tinyCorp
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Chips() {
  const data = useChatData()
  return <p>{data.repos.map((one) => one.name).join(' ')}</p>
}

async function open(): Promise<void> {
  await act(async () => {
    root.render(<Chips />)
  })
}

describe('the repos the Chat view draws', () => {
  it('reads them again when the repos change', async () => {
    await open()
    expect(host.textContent).toBe('billing-api')

    repos = [repo('billing-api'), repo('web-app')]
    await fire('repos')

    expect(host.textContent).toBe('billing-api web-app')
  })

  it('does not read them again on a hire, which is not what changes them', async () => {
    await open()
    expect(read).toHaveBeenCalledTimes(1)

    await fire('staff')

    expect(read).toHaveBeenCalledTimes(1)
  })
})
