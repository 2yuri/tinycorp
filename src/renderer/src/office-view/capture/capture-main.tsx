// The capture page's entry (`keep-awake-capture.html`). The menu is opened by clicking the real
// cup, so the capture shows the component's own open state rather than a posed copy of it.
// `?capture=budget` draws the out-of-budget card over the office floor instead (T209).
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { createRoot } from 'react-dom/client'
import { KeepAwakeCapture, OutOfBudgetCapture } from './KeepAwakeCapture'

const budget = new URLSearchParams(location.search).get('capture') === 'budget'

createRoot(document.getElementById('root')!).render(budget ? <OutOfBudgetCapture /> : <KeepAwakeCapture />)

// The screenshot may arrive before React has committed, so keep asking until the menu is up. Both
// of these are found by what they say about themselves, because the classes went with the sheet —
// and both are lower case, because an upper-case string constant in a file Tailwind reads is a
// class list by this repo's convention, and a selector is not one.
const cup = 'button[aria-haspopup="menu"]'
const menu = '[role="menu"][aria-label="Keep this Mac awake"]'
const open = setInterval(() => {
  if (budget || document.querySelector(menu)) return clearInterval(open)
  document.querySelector<HTMLButtonElement>(cup)?.click()
}, 50)
