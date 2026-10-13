// The capture page's entry (`activity-capture.html`).
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { activityCapture } from './ActivityCapture'

createRoot(document.getElementById('root')!).render(<StrictMode>{activityCapture()}</StrictMode>)
