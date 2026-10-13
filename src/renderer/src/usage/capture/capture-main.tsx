// The capture page's entry (`usage-capture.html`): the stub goes in before any view module reads it.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { usageCapture } from './UsageCapture'

const which = new URLSearchParams(location.search).get('capture') ?? 'popover'
void usageCapture(which).then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
