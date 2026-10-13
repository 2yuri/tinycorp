// The capture page's entry (`company-memory-capture.html`).
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { memoryCapture } from './MemoryCapture'

void memoryCapture().then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
