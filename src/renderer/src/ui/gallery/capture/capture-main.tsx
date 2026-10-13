// The capture page's entry (`gallery-capture.html`): the kit's own page, on its own, so a change
// to the kit can be shot and scored rather than read (T215).
//
// `index.html?gallery` draws the same page in `pnpm dev`, but it draws it through `main.tsx`,
// which asks the preload bridge which platform's window buttons to leave room for — so a
// screenshot of it against a bridge that is not there is a blank window, which is exactly the
// silent pass a capture harness exists to prevent.
import '../../fonts'
import '../../tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Gallery } from '../Gallery'

const query = new URLSearchParams(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery theme={query.get('theme') === 'dark' ? 'dark' : 'light'} />
  </StrictMode>,
)
