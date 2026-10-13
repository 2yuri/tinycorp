// The capture page's entry (`repositories-capture.html`).
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { repositoriesCapture } from './RepositoriesCapture'

createRoot(document.getElementById('root')!).render(<StrictMode>{repositoriesCapture()}</StrictMode>)
