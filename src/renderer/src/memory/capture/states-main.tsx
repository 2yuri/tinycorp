// The states page's entry (`company-memory-states-capture.html`): the stub goes in before any view module
// reads it, so the drawer panel mounts against the design's own fixture.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { memoryStatesCapture } from './MemoryStatesCapture'

void memoryStatesCapture().then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
