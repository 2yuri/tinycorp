// The capture page's entry (`crash-capture.html`): the card alone, on the content area's background.
import '../../../ui/fonts'
import '../../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { crashReport } from '../../../../../shared/app/crash'
import { CrashCard } from '../CrashCard'

/** The crash the frame draws, down to its message, its frame and its minute. */
const report = crashReport({
  source: 'view',
  error: new TypeError('destroy_ is not a function'),
  componentStack: '    at FileTree (files/FileTree.tsx:48)',
  route: 'board',
  version: 'capture',
  platform: 'darwin',
  at: new Date(2026, 8, 21, 12, 41),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ display: 'flex', flexDirection: 'column', width: 1010, height: 880 }}>
      <CrashCard report={report} where="Board · Tiny Corp" onReload={() => {}} />
    </div>
  </StrictMode>,
)
