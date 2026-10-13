import { describe, expect, it } from 'vitest'
import type { Column } from './domain/board'
import { blockerCandidates, openBlockers, unblockedBy, waitingRefusal, wouldLoop } from './ticket-links'

const t = (id: number, column: Column, blockedBy: number[] = [], blocks: number[] = []) => ({
  id,
  column,
  blockedBy,
  blocks,
})

describe('ticket links (T266)', () => {
  it('waits while any blocker is not Done', () => {
    const tickets = [t(1, 'todo', [2, 3]), t(2, 'done'), t(3, 'review')]
    expect(openBlockers(tickets[0]!, tickets).map((x) => x.id)).toEqual([3])
  })

  it('finds a loop however long it is', () => {
    const edges: Record<number, number[]> = { 1: [2], 2: [3], 3: [] }
    const blockedBy = (id: number) => edges[id] ?? []
    expect(wouldLoop(3, 1, blockedBy)).toBe(true)
    expect(wouldLoop(1, 3, blockedBy)).toBe(false)
    expect(wouldLoop(4, 4, blockedBy)).toBe(true)
  })

  it('offers no ticket itself, none it would loop with, none already a blocker and none Done', () => {
    const tickets = [t(1, 'todo', [2]), t(2, 'todo'), t(3, 'doing', [1]), t(4, 'done'), t(5, 'planning')]
    expect(blockerCandidates(tickets[0]!, tickets).map((x) => x.id)).toEqual([5])
  })

  it('names what a freed ticket was waiting on, and only frees one with nothing left open', () => {
    const tickets = [t(1, 'done', [], [2, 3]), t(2, 'todo', [1]), t(3, 'todo', [1, 4]), t(4, 'doing')]
    expect(unblockedBy(tickets[0]!, tickets).map((x) => x.id)).toEqual([2])
    expect(waitingRefusal('TC-150', ['TC-138', 'TC-131'])).toBe(
      'TC-150 waits on TC-138 and TC-131, which are not Done yet. Remove the blockers to start it now.',
    )
  })
})
