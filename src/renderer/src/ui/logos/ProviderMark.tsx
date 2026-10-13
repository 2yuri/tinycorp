import { Braces, type LucideIcon, Sparkles, SquareTerminal } from 'lucide-react'
import { PROVIDER_ICON, PROVIDER_LOGO, type Provider, type ProviderIcon } from '../../../../shared/domain/providers'
import { Logo, type MarkProps } from './Logo'
import { logoUrl } from './logo-assets'

/**
 * The generic marks of frame `TMviL`, by the name a catalogue entry gives its own (`icon`), for a
 * Provider this repo ships no logo for. One that names a mark nobody draws — or none at all, like
 * the products TinyCorp has no adapter for yet — gets the terminal, so a new one renders with no
 * edit here.
 */
const PROVIDER_MARKS: Record<ProviderIcon, LucideIcon> = {
  sparkles: Sparkles,
  braces: Braces,
  terminal: SquareTerminal,
}

/**
 * A Provider, drawn: its own logo where the catalogue names one, and its generic mark where it
 * does not. More than one screen draws a Provider — the model picker (`CLSj9`), the Usage popover
 * (`TMviL`), Your profile (`Oykzs`) and the preflight card (`KB9AX`) — and all of them draw this.
 *
 * **Which Provider is drawn is the only thing the caller says.** Everything else — the logo, the
 * fallback mark — is read from the catalogue in `shared/domain/providers.ts`, which is what keeps
 * `no-provider-names.test.ts` green and adding a Provider to one folder and two lines.
 */
export function ProviderMark({ provider, size = 16, className }: { provider: string } & MarkProps) {
  const named = (PROVIDER_LOGO as Partial<Record<string, string | null>>)[provider as Provider]
  if (named && logoUrl(named)) return <Logo name={named} size={size} className={className} />
  const icon = (PROVIDER_ICON as Partial<Record<string, ProviderIcon>>)[provider as Provider]
  const Mark = (icon && PROVIDER_MARKS[icon]) ?? SquareTerminal
  return <Mark size={size} aria-hidden className={className} />
}
