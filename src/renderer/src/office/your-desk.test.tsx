import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeskPanel } from './BossDesk'
import { deskView } from './desk-view'

/** An empty desk: enough of a `ChatData` for the panel to draw its frame. */
const data = { employees: [], bossName: 'You', channels: [], messages: [], board: null } as never

describe('the desk panel', () => {
  it('floats over the office like the Employee drawer, so the room keeps its size', () => {
    const html = renderToStaticMarkup(
      <DeskPanel
        view={deskView([], [], data)}
        data={data}
        onClose={() => {}}
        onOpen={() => {}}
        onSend={async () => true}
      />,
    )
    const panel = /<aside class="([^"]*)"/.exec(html)?.[1] ?? ''

    expect(panel).toContain('absolute')
    expect(panel).toContain('z-10')
    // A panel that took the office's height would be a column of the split, and opening it would
    // resize the room. `inset-y-0` pins it to the floor it floats over instead.
    expect(panel).not.toContain('h-full')
  })
})
