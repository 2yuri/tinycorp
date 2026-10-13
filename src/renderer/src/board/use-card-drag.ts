/**
 * Dragging a card from one column to another (T214).
 *
 * The board used to hold the two states and the three handlers itself, with the index arithmetic
 * inline in a component that already ran the scope, the filter, the drawer and the modal. The
 * arithmetic is the part that was never tested, and it is a pure function here.
 */
import { type DragEvent, useState } from 'react'
import type { Column } from '../../../shared/domain/board'

/** Where the line between two cards is drawn while a card is over a column. */
export interface DropHint {
  column: Column
  index: number
}

export interface CardDrag {
  /** The ticket being dragged, or null while nothing is. */
  dragged: number | null
  hint: DropHint | null
  start(id: number): void
  /** The pointer moved over a column: the line goes between the two cards it is between. */
  over(event: DragEvent<HTMLElement>, column: Column): void
  /** The card was let go: `place` is called with the ticket and where in the column it landed. */
  drop(event: DragEvent<HTMLElement>, place: (id: number, at: number) => void): void
  end(): void
}

export function useCardDrag(): CardDrag {
  const [dragged, setDragged] = useState<number | null>(null)
  const [hint, setHint] = useState<DropHint | null>(null)

  const end = () => {
    setDragged(null)
    setHint(null)
  }

  return {
    dragged,
    hint,
    start: setDragged,
    over: (event, column) => {
      if (dragged === null) return
      event.preventDefault()
      const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-ticket]')]
      const below = cards.findIndex((card) => {
        const box = card.getBoundingClientRect()
        return event.clientY < box.top + box.height / 2
      })
      const index = below === -1 ? cards.length : below
      if (hint?.column !== column || hint.index !== index) setHint({ column, index })
    },
    drop: (event, place) => {
      event.preventDefault()
      if (dragged === null || !hint) return
      place(dragged, hint.index)
      end()
    },
    end,
  }
}

/**
 * Where the engine is told to put the ticket. The board only ever shows some of a column — a
 * filter, a scope — so the card is placed next to the neighbour the boss can see, and the engine
 * counts positions in the whole column without the ticket that is moving.
 */
export function dropIndex(
  inColumn: readonly { id: number }[],
  shown: readonly { id: number }[],
  at: number,
  dragged: number,
): number {
  const neighbour = shown[at]
  const index = neighbour ? inColumn.findIndex((ticket) => ticket.id === neighbour.id) : inColumn.length
  const from = inColumn.findIndex((ticket) => ticket.id === dragged)
  return from !== -1 && from < index ? index - 1 : index
}
