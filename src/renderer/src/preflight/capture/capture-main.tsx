// The capture page's entry (`preflight-capture.html`): the stub goes in before any view module
// reads it. `?state=missing|signed-out|warning|ready` picks which of the four every Provider is
// in, `?states=missing,signed-out` one per Provider, and `?providers=claude,codex` how many the
// screen draws. `?hired=0` is the chooser of frame `KB9AX`: nobody hired, so nobody is stopped and
// the rows are one card rather than three.
import '../../ui/fonts'
import '../../ui/tailwind.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PROVIDER_LABEL, type Provider } from '../../../../shared/domain/providers'
import type { TinyCorpApi } from '../../../../shared/ipc'
import type { PreflightState, ProviderPreflight } from '../../../../shared/providers/preflight'

// The Launcher frame's title bar asks for the update state (T130), so the stub answers that too.
window.tinyCorp = {
  shell: { toggleMaximize: () => Promise.resolve() },
  updates: {
    get: () => Promise.resolve({ current: 'capture', available: null, checkedAt: null, checking: false }),
    onChanged: () => () => {},
    checkNow: () => Promise.resolve({ current: 'capture', available: null, checkedAt: null, checking: false }),
    openDownloadPage: () => Promise.resolve(),
  },
} as unknown as TinyCorpApi

const query = new URLSearchParams(window.location.search)
const asked = (query.get('state') ?? 'signed-out') as PreflightState
const providers = (query.get('providers') ?? 'claude').split(',') as Provider[]
const perProvider = (query.get('states') ?? '').split(',').filter((one) => one !== '') as PreflightState[]
/** Whether an Employee is hired on these Providers. Nobody hired is the chooser (T250). */
const hired = query.get('hired') !== '0'
/**
 * `?places=windows-wsl` draws the Windows card of frame `c8knu` (T167): the same card, with an
 * install command per place and the line saying where the app looked. Left out, it is the Mac's,
 * which has one place and says nothing about it.
 *
 * `?places=chosen-empty` is T258's: the boss chose WSL · Arch on the first launch and the CLI is not
 * in there. One place to install into rather than two, because they have already said which — and
 * the body carries the other way out, which is to run this Provider where the CLI already is.
 */
const twoPlaces = query.get('places') === 'windows-wsl'
const chosenEmpty = query.get('places') === 'chosen-empty'

/** What each Provider's own adapter would have written, spelled out here so the page needs no main. */
function check(provider: Provider, state: PreflightState): ProviderPreflight {
  const name = PROVIDER_LABEL[provider]
  // Each product's own commands, as its adapter writes them. A fixture, so naming them here is the
  // point: the page has no main process to ask.
  const COMMANDS: Record<string, { install: string; login: string; status: string; windows?: string; wsl?: string }> = {
    claude: {
      install: 'npm install -g @anthropic-ai/claude-code',
      login: 'claude /login',
      status: 'claude auth status',
      windows: 'irm https://claude.ai/install.ps1 | iex',
      wsl: 'curl -fsSL https://claude.ai/install.sh | bash',
    },
    codex: { install: 'npm install -g @openai/codex', login: 'codex login', status: 'codex login status' },
    opencode: { install: 'npm install -g opencode-ai', login: 'opencode auth login', status: 'opencode auth list' },
  }
  const { install, login, status, windows, wsl } = COMMANDS[provider] ?? {
    install: `npm install -g ${provider}`,
    login: `${provider} login`,
    status: `${provider} status`,
  }
  const still = 'The rest of the app still opens — nothing runs until this is sorted.'
  const signedIn = { account: `boss@${provider}.test`, plan: 'Max' }
  const signedOut = { account: null, plan: null }
  const words: Record<PreflightState, Omit<ProviderPreflight, 'provider' | 'checkedAt' | 'state' | 'hired'>> = {
    missing: {
      title: chosenEmpty ? `${name} is not installed in WSL · Arch` : `${name} is not installed`,
      body: chosenEmpty
        ? `TinyCorp could not find the ${provider} command in WSL · Arch, where you chose to run it — so no Employee on ${name} can start. Or pick Windows for this Provider in Your profile → Providers.`
        : twoPlaces
          ? `TinyCorp could not find the ${provider} command on Windows or inside WSL — so no Employee on ${name} can start.`
          : `TinyCorp could not find the ${provider} command on this Mac — so no Employee on ${name} can start.`,
      lead: chosenEmpty
        ? 'Install it where you chose to run it:'
        : twoPlaces
          ? 'Install it on Windows, or inside WSL — either works:'
          : 'Install it once, in a terminal, and every Company here works:',
      commands: [install, login],
      ...(chosenEmpty && {
        steps: [
          {
            kind: 'install' as const,
            runtime: { kind: 'wsl' as const, distro: 'Arch' },
            label: 'WSL · Arch',
            hint: 'bash',
            prompt: '$',
            command: wsl ?? install,
          },
          {
            kind: 'sign-in' as const,
            runtime: null,
            label: 'Then sign in',
            hint: 'where you installed it',
            prompt: '$',
            command: login,
          },
        ],
        lookedIn: 'Looked in: Windows PATH · WSL: Arch',
      }),
      ...(twoPlaces && {
        steps: [
          {
            kind: 'install' as const,
            runtime: { kind: 'windows' as const },
            label: 'Windows',
            hint: 'PowerShell',
            prompt: '>',
            command: windows ?? install,
          },
          {
            kind: 'install' as const,
            runtime: { kind: 'wsl' as const, distro: 'Ubuntu' },
            label: 'WSL · Ubuntu',
            hint: 'bash',
            prompt: '$',
            command: wsl ?? install,
          },
          {
            kind: 'sign-in' as const,
            runtime: null,
            label: 'Then sign in',
            hint: 'where you installed it',
            prompt: '$',
            command: login,
          },
        ],
        lookedIn: 'Looked in: Windows PATH · WSL: Ubuntu',
      }),
      note: still,
      ...signedOut,
    },
    'signed-out': {
      title: `${name} is not signed in`,
      body: `TinyCorp found the command, but no subscription login — so no Employee on ${name} can start.`,
      lead: 'Sign in once, in a terminal, and every Company here works:',
      commands: [login, status],
      note: still,
      ...signedOut,
    },
    warning: {
      title: `${name} is using an API key`,
      body: 'ANTHROPIC_API_KEY is set around TinyCorp. Every Employee runs on your subscription login, and a Session never inherits those variables, so this key is not what will be billed.',
      lead: 'Clear it where you start TinyCorp if you would rather it were not there at all:',
      commands: ['unset ANTHROPIC_API_KEY', status],
      note: 'Everything still runs — this is here so the bill is never a surprise.',
      ...signedIn,
    },
    ready: {
      title: `${name} is signed in`,
      body: `Every Employee on ${name} runs as a session on your own subscription.`,
      lead: '',
      commands: [],
      note: 'Nothing to do.',
      ...signedIn,
    },
  }
  return { provider, state, checkedAt: new Date().toISOString(), hired, ...words[state] }
}

const blocked = providers.map((provider, index) => check(provider, perProvider[index] ?? asked))

const { PreflightScreen } = await import('../PreflightScreen')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ width: 680, height: 740, overflow: 'hidden' }}>
      <PreflightScreen blocked={blocked} boss={null} checking={false} onRecheck={() => {}} onDismiss={() => {}} />
    </div>
  </StrictMode>,
)
