// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Company } from '../../../shared/company'
import type { Employee } from '../../../shared/domain/staff'
import { resources } from './resources'
import { type IpcResource, useIpcResource, useIpcSnapshot } from './use-ipc-resource'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * The one store per channel behind every screen (T212).
 *
 * What is tested here is the thing the old private `useLive` copies could not do: however many
 * components read a channel, the engine is asked once and hears one subscription — and an answer
 * that arrives after the Company has changed under it is dropped rather than drawn.
 */

const employee = (id: string): Employee =>
  ({ id, name: id, roleId: 'r1', provider: 'claude', status: 'idle' }) as unknown as Employee

const company = (id: string): Company => ({ id, name: id }) as unknown as Company

/** A staff bridge that hands back the reads it was asked for and the listeners it was given. */
function bridge() {
  const staffListeners: (() => void)[] = []
  const companyListeners: ((company: Company | null) => void)[] = []
  const answers: ((value: Employee[]) => void)[] = []
  const employees = vi.fn(
    () =>
      new Promise<{ ok: true; value: Employee[] }>((resolve) => {
        answers.push((value) => resolve({ ok: true, value }))
      }),
  )
  const onChanged = vi.fn((listener: () => void) => {
    staffListeners.push(listener)
    return () => {
      staffListeners.splice(staffListeners.indexOf(listener), 1)
    }
  })
  const onCompanyChanged = vi.fn((listener: (company: Company | null) => void) => {
    companyListeners.push(listener)
    return () => {
      companyListeners.splice(companyListeners.indexOf(listener), 1)
    }
  })
  window.tinyCorp = {
    staff: { employees, onChanged },
    company: { current: () => Promise.resolve(company('c1')), onChanged: onCompanyChanged },
  } as unknown as typeof window.tinyCorp
  return {
    employees,
    onChanged,
    onCompanyChanged,
    staffListeners,
    companyListeners,
    /** Answers the read that is out, oldest first. */
    answer: (value: Employee[]) => act(async () => answers.shift()?.(value)),
    /** Answers every read that is out, oldest first: the engine owes an answer to each. */
    drain: (value: Employee[]) =>
      act(async () => {
        for (const answer of answers.splice(0)) answer(value)
      }),
    reads: () => answers.length,
  }
}

let api: ReturnType<typeof bridge>
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  api = bridge()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Names({ label }: { label: string }) {
  const staff = useIpcResource(resources.employees)
  return <p data-ui={label}>{staff.map((one) => one.name).join(' ')}</p>
}

const text = (label: string) => host.querySelector(`[data-ui="${label}"]`)?.textContent ?? null

/** The engine saying which Company is open now. */
const switchTo = (id: string) =>
  act(async () => {
    for (const listener of api.companyListeners) listener(company(id))
  })

async function render(element: ReactNode): Promise<void> {
  await act(async () => {
    root.render(element)
  })
}

describe('a channel read once for every reader', () => {
  it('asks the engine once and subscribes once, however many components read it', async () => {
    await render(
      <>
        <Names label="a" />
        <Names label="b" />
        <Names label="c" />
      </>,
    )

    expect(api.employees).toHaveBeenCalledTimes(1)
    expect(api.onChanged).toHaveBeenCalledTimes(1)
  })

  it('gives every reader the same answer', async () => {
    await render(
      <>
        <Names label="a" />
        <Names label="b" />
      </>,
    )

    await api.answer([employee('Iris'), employee('Ada')])

    expect(text('a')).toBe('Iris Ada')
    expect(text('b')).toBe('Iris Ada')
  })

  it('reads again once, not once per reader, when the channel says it changed', async () => {
    await render(
      <>
        <Names label="a" />
        <Names label="b" />
        <Names label="c" />
      </>,
    )
    await api.answer([employee('Iris')])

    await act(async () => {
      for (const listener of api.staffListeners) listener()
    })

    expect(api.employees).toHaveBeenCalledTimes(2)
    await api.answer([employee('Iris'), employee('Ada')])
    expect(text('c')).toBe('Iris Ada')
  })

  it('lets go of the channel when the last reader does', async () => {
    await render(<Names label="a" />)
    expect(api.staffListeners).toHaveLength(1)

    await render(<p />)

    expect(api.staffListeners).toHaveLength(0)
    expect(api.companyListeners).toHaveLength(0)
  })

  /** A screen reopened reads again rather than drawing what the last Company had on it. */
  it('keeps nothing once nobody is looking', async () => {
    await render(<Names label="a" />)
    await api.answer([employee('Iris')])
    await render(<p />)

    await render(<Names label="a" />)

    expect(text('a')).toBe('')
    expect(api.employees).toHaveBeenCalledTimes(2)
  })
})

describe('a Company switch under an answer', () => {
  it('ignores the answer that was already out', async () => {
    await render(<Names label="a" />)

    await switchTo('c2')
    // The read the first Company asked for, coming back after the switch.
    await api.answer([employee('Iris')])

    expect(text('a')).toBe('')
  })

  it('reads every channel again, and draws the new Company once it answers', async () => {
    await render(<Names label="a" />)
    await api.answer([employee('Iris')])

    await switchTo('c2')
    expect(text('a')).toBe('')
    expect(api.employees).toHaveBeenCalledTimes(2)

    await api.answer([employee('Ada')])
    expect(text('a')).toBe('Ada')
  })

  /** Company settings' Save fires the same event; it is a rename, so what is on screen stays. */
  it('leaves what is on screen alone when the same Company changes', async () => {
    await render(<Names label="a" />)
    await switchTo('c1')
    await api.drain([employee('Iris')])

    await switchTo('c1')

    expect(text('a')).toBe('Iris')
    expect(api.employees).toHaveBeenCalledTimes(3)
  })
})

describe('a read the engine refuses', () => {
  const refused: IpcResource<string[]> = {
    key: 'test.refused',
    needs: ['staff'],
    empty: [],
    read: () => Promise.resolve({ ok: false, error: 'No Company is open' }),
    subscribe: () => () => {},
  }

  it('says so, and is not left waiting', async () => {
    let seen: { value: string[]; loading: boolean; error: string | null } | null = null
    function Reader() {
      seen = useIpcSnapshot(refused)
      return <p />
    }

    await render(<Reader />)

    expect(seen).toEqual({ value: [], loading: false, error: 'No Company is open' })
  })
})
