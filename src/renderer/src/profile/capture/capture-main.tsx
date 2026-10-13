// The capture page's entry (`profile-capture.html`): the stub goes in before any view module reads it.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { profileCapture } from './ProfileCapture'

void profileCapture().then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
