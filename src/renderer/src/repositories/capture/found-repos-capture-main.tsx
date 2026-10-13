// The Found repositories capture's entry (`found-repos-capture.html`, T168). `?state=scanning`,
// `?state=empty` and `?state=self` draw the three states frame `XHkqC` shows. Nothing here ships.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { type CaptureState, foundReposCapture } from './FoundReposCapture'

const state = (new URLSearchParams(location.search).get('state') ?? 'found') as CaptureState

createRoot(document.getElementById('root')!).render(<StrictMode>{foundReposCapture(state)}</StrictMode>)
