// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ShellData } from './nav-model'

/**
 * Switching Company while the sidebar is reading (T211).
 *
 * The reads behind the sidebar are out when the boss can already have switched Company. Until T211
 * the answer was drawn whenever it arrived, so the new Company's sidebar filled with the old one's
 * Employees, channels and tickets — and stayed that way until the next engine event happened to
 * come along.
 *
 * Since T212 the sidebar reads the same channels every screen reads, and it is `company.onChanged`
 * — the event that makes `companyId` change in the first place — that drops what is in flight. So
 * the switch is signalled here the way the engine signals it, and the promise is the same one.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const never = () => () => {}

/** One Company's roster, held back until the test lets it go. */
function roster(name: string) {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    release,
    async employees() {
      await held
      return { ok: true as const, value: [{ id: `${name}-1`, name, roleId: 'backend' }] }
    },
  }
}

const acme = roster('Acme')
const zeta = roster('Zeta')
let answering = acme
/** What the engine tells the whole renderer when the open Company changes. */
const switches: ((company: { id: string } | null) => void)[] = []

let useShellData: typeof import('./use-shell-data').useShellData

beforeAll(async () => {
  ;(window as unknown as { tinyCorp: unknown }).tinyCorp = {
    staff: { employees: () => answering.employees(), roles: () => ok([]), onChanged: never },
    company: {
      onChanged: (listener: (company: { id: string } | null) => void) => {
        switches.push(listener)
        return never()
      },
    },
    chat: {
      channels: () => ok([]),
      agentPairs: () => ok([]),
      unread: () => ok({}),
      draftedChannels: () => ok([]),
      bossInbox: () => ok([]),
      onChanged: never,
    },
    board: { snapshot: () => Promise.resolve(null), onChanged: never },
    repos: { list: () => ok([]), onChanged: never },
    code: { list: () => ok([]), onChanged: never },
    approvals: { list: () => ok([]), level: () => ok('supervised'), onChanged: never },
    companyMemory: { counts: () => ok({ pages: 0 }), onChanged: never },
  }
  ;({ useShellData } = await import('./use-shell-data'))
})

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
})

/** The names the sidebar is showing right now. */
let shown: string[] = []

function Probe({ companyId }: { companyId: string }) {
  const data: ShellData = useShellData(companyId)
  shown = data.employees.map((employee) => employee.name)
  return null
}

async function render(companyId: string) {
  if (!root) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  await act(async () => {
    root!.render(<Probe companyId={companyId} />)
  })
}

/** The Company the engine says is open now, and then the sidebar drawn for it. */
async function switchTo(companyId: string) {
  await act(async () => {
    for (const listener of switches) listener({ id: companyId })
  })
  await render(companyId)
}

describe('useShellData, when the boss switches Company mid-read', () => {
  it('never draws the Company they left', async () => {
    await render('acme')
    expect(shown).toEqual([])

    // Acme's read is still out when Zeta becomes the open Company.
    answering = zeta
    await switchTo('zeta')

    await act(async () => {
      acme.release()
      await Promise.resolve()
    })
    expect(shown).toEqual([])

    await act(async () => {
      zeta.release()
      await Promise.resolve()
    })
    expect(shown).toEqual(['Zeta'])
  })
})
