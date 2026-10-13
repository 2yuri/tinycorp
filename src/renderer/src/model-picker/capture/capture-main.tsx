// The capture page's entry (`model-picker-capture.html`): frame `CLSj9` side by side, MODEL and
// EFFORT in three of their states on the left and the open catalogue on the right. `?open=0`
// leaves the menu shut. Nothing here ships — no app module imports this folder.
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { PROVIDER_CATALOGUE, type Provider } from '../../../../shared/domain/providers'
import type { PreflightState, ProviderPreflight } from '../../../../shared/providers/preflight'
import { ModelPicker } from '../ModelPicker'
import '../../ui/fonts'
import '../../ui/tailwind.css'

const query = new URLSearchParams(location.search)
const openMenu = query.get('open') !== '0'
/** `?menu=end` scrolls the open catalogue to its last group, which is the one that is not ready. */
const toEnd = query.get('menu') === 'end'

/** A cached preflight answer; only its state reaches this control, so the words can be empty. */
function answer(provider: Provider, state: PreflightState): ProviderPreflight {
  return {
    provider,
    state,
    title: '',
    body: '',
    lead: '',
    commands: [],
    note: '',
    account: null,
    plan: null,
    checkedAt: '',
    hired: false,
  }
}

/** The frame's three: the first two Providers signed in, the last one with no CLI on this Mac. */
const preflight = PROVIDER_CATALOGUE.map((entry, index) =>
  answer(entry.id, index === PROVIDER_CATALOGUE.length - 1 ? 'missing' : 'ready'),
)

/**
 * The frame's own three: one field per Provider, each on a model that carries a level, so all
 * three draw a populated EFFORT control — the last of them under a field that cannot start. A
 * Provider with no level anywhere falls back to its first model and shows the line the control
 * says instead.
 */
const fields = PROVIDER_CATALOGUE.map((entry) => ({
  provider: entry.id,
  model: (entry.models.find((option) => option.effort !== null) ?? entry.models[0])!.id,
}))

/** The capture page's own furniture: the frame's two columns, so nothing here is app CSS. */
const COLUMN = 'flex flex-col gap-28'
const NOTE = 'm-0 max-w-560 text-13-5/21 text-muted-foreground'

/** Opens the menu the way the boss does, so the capture is the control's own open state. */
function OpenMenu({ children }: { children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const field = host.current?.querySelector<HTMLButtonElement>('button[aria-label="Model"]')
    if (field?.getAttribute('aria-expanded') === 'false') field.click()
    // The menu is only in the document after the click's render, so the scroll waits a tick.
    const scroll = setTimeout(() => {
      // The menu is the kit's, by its role: the control's own class went with its stylesheet (T210f).
      const menu = host.current?.querySelector('[role="menu"]')
      if (toEnd && menu) menu.scrollTop = menu.scrollHeight
    })
    return () => clearTimeout(scroll)
  }, [])
  return (
    // The open menu is absolute inside the control, so the column keeps room for it — and the
    // control is held at the menu's own 560, which is what it is in the app's 404px side panel.
    <div className="min-h-500 w-560" ref={host}>
      {children}
    </div>
  )
}

// No `StrictMode`: it would mount the page twice, and the second mount would toggle the menu shut.
createRoot(document.getElementById('root')!).render(
  <div className="grid grid-cols-2 gap-48 bg-background px-36 py-40 font-sans">
    <div className={COLUMN}>
      <p className={NOTE}>
        Two controls, not two products. The model says which product runs it. The effort is its own choice — the word
        the CLI is handed, never one of ours — and the levels belong to the model, not the provider.
      </p>
      {fields.map((field) => (
        <ModelPicker
          key={field.provider}
          value={field.model}
          provider={field.provider}
          preflight={preflight}
          who="Ada"
          onChange={() => {}}
        />
      ))}
    </div>
    <div className={COLUMN}>
      <p className={NOTE}>
        Open, it is the catalogue: every provider the Company knows, each of its models once. A provider whose CLI is
        not ready is still listed — greyed, with the reason — because the place you choose a model is where you should
        find out.
      </p>
      {openMenu && (
        <OpenMenu>
          <ModelPicker
            value={PROVIDER_CATALOGUE[0]!.models[1]!.id}
            provider={PROVIDER_CATALOGUE[0]!.id}
            preflight={preflight}
            who="Ada"
            onChange={() => {}}
          />
        </OpenMenu>
      )}
    </div>
  </div>,
)
