// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Mentionable } from '../../../shared/domain/chat'
import type { SlashComposer } from './Composer'
import type { ChatData } from './chat-view'

/**
 * The Company key reaches the chat view after the first render — `ChatData.companyKey` is "absent
 * until the Company is read". The composer is a `useMemo`, and until T190 the key was captured
 * without being named in its dependencies: `/ticket` then kept reporting the ticket it made with
 * the key it was born with, so the first one of a session read `-142` instead of `TC-142`.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const never = () => () => {}

/** Stable, as the view's own `people` is: a fresh array each render would rebuild the memo anyway. */
const PEOPLE: Mentionable[] = []

let useSlashComposer: typeof import('./use-slash').useSlashComposer

beforeAll(async () => {
  ;(window as unknown as { tinyCorp: unknown }).tinyCorp = {
    staff: { roles: () => ok([]), onChanged: never },
    chat: {},
    sessions: {},
    approvals: {},
    board: {
      apply: () => ok({ tickets: [{ id: 142, title: 'Range picker' }] }),
    },
  }
  ;({ useSlashComposer } = await import('./use-slash'))
})

const noop = () => {}

/** The rest of the snapshot held still, so the key is the only thing that moves between renders. */
const REST = { employees: [], board: null, approvals: new Map() }

const dataWith = (companyKey?: string): ChatData =>
  ({ ...REST, ...(companyKey !== undefined && { companyKey }) }) as unknown as ChatData

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

/** Renders the hook and hands back the composer it last produced. */
function drawComposer(): { render(data: ChatData): void; composer(): SlashComposer } {
  let latest: SlashComposer | null = null
  function Probe({ data }: { data: ChatData }) {
    latest = useSlashComposer({ channelId: 'general', threadId: null, data, people: PEOPLE, openChannel: noop })
    return null
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  return {
    render: (data) => act(() => root!.render(<Probe data={data} />)),
    composer: () => latest!,
  }
}

describe('the slash composer', () => {
  it('names a new ticket with the Company key that has arrived, not the one it opened with', async () => {
    const probe = drawComposer()
    probe.render(dataWith())
    // The roles the composer completes `/hire` against land first; the Company key follows.
    await act(async () => {})

    probe.render(dataWith('TC'))
    const outcome = await probe.composer().run('/ticket Range picker')

    expect(outcome).toEqual({ ok: true, note: 'Created TC-142 in Todo.' })
  })
})

describe('the skills a draft can invoke (T264)', () => {
  const catalogue = [
    { id: 's-checks', name: 'review-checklist', description: 'The checks', missing: false },
    { id: 's-runbook', name: 'deploy-runbook', description: 'How a release goes out', missing: false },
  ]

  it('are the Employee’s own, in catalogue order, under their name', async () => {
    const { heldSkills } = await import('./use-slash')
    const orion = { id: 'e-orion', name: 'Orion', skills: ['s-runbook', 's-checks'] }

    expect(heldSkills('e-orion', [orion], catalogue)).toEqual({
      owner: 'Orion',
      skills: [
        { name: 'review-checklist', description: 'The checks', missing: false },
        { name: 'deploy-runbook', description: 'How a release goes out', missing: false },
      ],
    })
  })

  it('are no group at all for an Employee who holds none, or for nobody', async () => {
    const { heldSkills } = await import('./use-slash')

    expect(heldSkills('e-juno', [{ id: 'e-juno', name: 'Juno', skills: [] }], catalogue)).toBeNull()
    expect(heldSkills(null, [], catalogue)).toBeNull()
  })
})
