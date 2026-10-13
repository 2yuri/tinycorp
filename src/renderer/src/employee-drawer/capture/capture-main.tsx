// The capture page's entry (`drawer-capture.html`): the stub goes in before any view module reads it.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { drawerCapture } from './DrawerCapture'

// `?view=subagents` is the Terminal tab with the frame's strip as subagents (T162), `?view=sessions`
// as Sessions Nova started (T163); either picks `tests`, as `CuLyV` draws it. `?view=handoff` is the
// stopped Session of `zOVl6`, where the handoff button is on; `?view=routed` is the routing chip
// of `tdI8o` (a), an Employee working on a fallback Provider while its own is out (T173).
const view = new URLSearchParams(location.search).get('view')
const strip = view === 'subagents' || view === 'sessions'
const drawn = view === 'subagents' || view === 'sessions' || view === 'handoff' || view === 'routed' ? view : 'chats'

// `?rtk=on` is the Company that is compressing, so the terminal header draws its chip; `?wakes`
// gives the Employee a wake list, which is the only state the Chats tab's `Wakes` fold is in (T209).
const query = new URLSearchParams(location.search)
const ticketQuery = query.get('ticket')
const ticket: 'folded' | 'open' | null = ticketQuery === 'folded' || ticketQuery === 'open' ? ticketQuery : null
const extras = {
  rtk: query.get('rtk') === 'on',
  wakes: query.has('wakes'),
  // `?ticket=folded` and `?ticket=open`: the card under the terminal with a long checklist (TI-2).
  ...(ticket && { ticket }),
}

void drawerCapture(drawn, extras).then((element) => {
  if (extras.wakes) {
    const open = () => {
      const fold = document.querySelector<HTMLDetailsElement>('.drawer-wakes')
      if (fold) fold.open = true
      else setTimeout(open, 50)
    }
    open()
  }
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
  if (strip) {
    const pick = () => {
      const chip = [...document.querySelectorAll<HTMLButtonElement>('.subagent-chip')].find(
        (c) => c.textContent === 'tests',
      )
      if (chip) chip.click()
      else setTimeout(pick, 50)
    }
    pick()
  }
  // `?view=handoff&copy=1` presses the handoff button, so the capture shows the toast of `zOVl6`.
  if (drawn === 'handoff' && new URLSearchParams(location.search).get('copy') === '1') {
    const press = () => {
      const button = document.querySelector<HTMLButtonElement>('.employee-drawer__handoff')
      if (button) button.click()
      else setTimeout(press, 50)
    }
    press()
  }
})
