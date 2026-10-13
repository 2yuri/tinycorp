import { describe, expect, it } from 'vitest'
import { dropIndex } from './use-card-drag'

/**
 * Where a dragged card lands. The arithmetic used to sit inside the board component, where nothing
 * could reach it: the two rules it carries are that the boss aims at a card they can see, and that
 * the engine counts positions in the column without the ticket that is moving.
 */
const column = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]

describe('Dropping a card into a column', () => {
  it('puts it where the card it was dropped above is', () => {
    expect(dropIndex(column, column, 0, 4)).toBe(0)
    expect(dropIndex(column, column, 2, 4)).toBe(2)
  })

  it('puts it last when it was dropped under everything', () => {
    expect(dropIndex(column, column, column.length, 1)).toBe(3)
  })

  it('counts without the ticket that is moving, so dragging one down moves it down', () => {
    // Ticket 1 dropped above 3: with the column counted as it will be, that is position 1, not 2.
    expect(dropIndex(column, column, 2, 1)).toBe(1)
  })

  it('aims at the neighbour the boss can see, not the one the filter hid', () => {
    // A filter leaves 2 and 4 on the board; dropping above 4 is position 3 of the whole column.
    const shown = [{ id: 2 }, { id: 4 }]

    expect(dropIndex(column, shown, 1, 9)).toBe(3)
  })
})
