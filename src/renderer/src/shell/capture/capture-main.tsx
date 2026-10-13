// The capture page's entry (`sidebar-capture.html`): the stub goes in before any view module reads it.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { railCapture, sidebarCapture } from './SidebarCapture'

// `?drafts` is the sidebar with unsent drafts, so its rows carry the pencil (TI-1); `?rail` is the
// Company rail on its own, at the size frame `u9sLao` measures its marks against (T251).
const query = new URLSearchParams(location.search)
const capture = query.has('rail') ? railCapture() : sidebarCapture({ drafts: query.has('drafts') })
void capture.then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
