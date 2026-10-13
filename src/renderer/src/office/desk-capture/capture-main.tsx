// The desk capture page's entry (`desk-capture.html`): the stub goes in before any view module reads it.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { deskCapture } from './DeskCapture'

void deskCapture().then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
