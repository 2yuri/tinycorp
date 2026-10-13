import './ui/fonts'
import './ui/tailwind.css'
import type { ReactNode } from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_NAME } from '../../shared/app/app-name'
import { App } from './App'
import { hostPlatform } from './chrome'
import { installCrashHandlers, ScreenBoundary } from './shell'
import { SignInHost } from './sign-in'

async function root(): Promise<ReactNode> {
  // The component gallery is dev-only (`?gallery`) and never ships in a build.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('gallery')) {
    const { Gallery } = await import('./ui')
    return <Gallery />
  }
  // The sign-in modal sits beside the app rather than in any screen of it (T263): the preflight
  // cards, Your profile and the Usage popover all open it, and the preflight takes the whole window.
  return (
    <>
      <App />
      <SignInHost />
    </>
  )
}

// A throw outside React is recorded too, rather than reaching a console nobody has open (T128).
installCrashHandlers()

// Which platform's window buttons the title bar has to leave room for (T166). On the root, because
// it is true for the whole window and never changes while it is open.
document.documentElement.dataset['platform'] = hostPlatform()

// `overflow: hidden` stops the wheel, not a focus or a scrollIntoView that reaches the page itself:
// whatever scrolls it, it goes straight back (T283).
addEventListener('scroll', () => {
  if (scrollX !== 0 || scrollY !== 0) scrollTo(0, 0)
})

void root().then((element) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* The last resort: a throw outside every view draws the same card, with no shell behind it. */}
      <ScreenBoundary where={APP_NAME} source="window">
        {element}
      </ScreenBoundary>
    </StrictMode>,
  )
})
