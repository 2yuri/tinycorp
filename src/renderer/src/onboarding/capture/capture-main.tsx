// The onboarding capture's entry (`onboarding-repos-capture.html`, T168). `?step=team` and
// `?step=first-ticket` draw the wizard's other two steps in the same chrome (T209).
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { onboardingReposCapture } from './OnboardingReposCapture'

const step = new URLSearchParams(location.search).get('step') ?? 'repositories'

createRoot(document.getElementById('root')!).render(<StrictMode>{onboardingReposCapture(step)}</StrictMode>)
