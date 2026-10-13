// The capture page's entry (`capture.html`): the stub goes in before any view module reads it.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { chatCapture } from './ChatCapture'

void chatCapture(new URLSearchParams(location.search).get('capture') ?? 'chat').then((element) => {
  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>)
})
