// The capture page's entry (`board-capture.html`): the stub goes in before any view module reads it.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The content header the view fills is the shell's, so the capture needs the shell's stylesheet.
import { boardCapture } from './BoardCapture'

void boardCapture().then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
