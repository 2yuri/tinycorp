// The capture page's entry (`edit-employee-capture.html`): Edit Employee on its own, so it can be
// compared with `design/screens/FbR2n.png`, and with `?modal=hire` the Hire Employee modal on the
// same fixture, against `design/screens/zf2Ks.png`. Nothing here ships — no app module imports
// this folder.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { createRoot } from 'react-dom/client'
import { EditCapture } from './EditCapture'
import { HireCapture } from './HireCapture'

const hiring = new URLSearchParams(location.search).get('modal') === 'hire'

// No `StrictMode`: it would mount the page twice, and the second mount would press `?role` again.
createRoot(document.getElementById('root')!).render(hiring ? <HireCapture /> : <EditCapture />)
