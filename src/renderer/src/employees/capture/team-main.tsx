// The Team capture page's entry (`team-capture.html`, T209): the stub goes in before any view
// module reads it. Nothing here ships — no app module imports this folder.
import '../../ui/fonts'
import '../../ui/tailwind.css'
// The screen's own header portals into the shell's 64px bar, and the bar and the screen are both
// built from utilities now (T210f), so the harness compiles them.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { teamCapture } from './TeamCapture'

void teamCapture().then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
