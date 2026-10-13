import { Plus, ShieldCheck } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GALLERY_COMPONENTS, Gallery } from '../gallery/Gallery'
import { Avatar, initialsOf } from './Avatar'
import { Badge } from './Badge'
import { Button } from './Button'
import { InputGroup, Search, Select } from './Field'
import { Tabs } from './Navigation'
import { Checkbox, Radio, Toggle } from './Selection'

/** Every kit component's source: since T216 the styling is in these files, not beside them. */
const kitSources = Object.entries(
  import.meta.glob<string>('./*.tsx', { query: '?raw', import: 'default', eager: true }),
).filter(([file]) => !file.includes('.test.'))

/**
 * The Components page (design/html/components.html), top to bottom, as named in the T21 ticket —
 * less the ten masters no screen ever instanced (T213). The page still draws a Stat Card, a Data
 * Table and a Top Bar; this app never did, and a master nothing instances is a master nobody
 * maintains. They come back out of the frame the day a screen needs one.
 */
const COMPONENTS_PAGE = [
  'Button',
  'Badge',
  'Avatar',
  'Input Group',
  'Select',
  'Search',
  'Textarea',
  'Checkbox',
  'Radio',
  'Toggle',
  'Progress',
  'Card',
  'Tabs',
  'Alert',
  'Toast',
  'Dropdown Menu',
  'Menu Item',
  'Empty State',
]

describe('component kit', () => {
  it('has a gallery that renders every component of the Components page, in page order', () => {
    expect(GALLERY_COMPONENTS).toEqual(COMPONENTS_PAGE)
    const html = renderToStaticMarkup(<Gallery />)
    const shown = [...html.matchAll(/data-ui="([^"]+)"/g)].map(([, name]) => name!)
    const firstSeen = [...new Set(shown)]
    expect(firstSeen.filter((name) => COMPONENTS_PAGE.includes(name))).toEqual(COMPONENTS_PAGE)
  })

  it('shows every designed variant in the gallery', () => {
    const html = renderToStaticMarkup(<Gallery />)
    // Each component says which variant it is on the element, so a gallery missing one is a gallery
    // missing a `data-variant` rather than a class name nothing reads (T216).
    const variantsOf = (slot: string) =>
      new Set([...html.matchAll(new RegExp(`data-slot="${slot}"[^>]*data-variant="([^"]+)"`, 'g'))].map(([, v]) => v!))
    expect(variantsOf('button')).toEqual(new Set(['primary', 'secondary', 'outline', 'ghost', 'destructive', 'icon']))
    expect(variantsOf('badge')).toEqual(new Set(['neutral', 'primary', 'success', 'warning', 'danger', 'count']))
    expect(variantsOf('alert')).toEqual(new Set(['info', 'success', 'warning', 'error']))
    expect(html).toContain('data-active="true"')
  })

  it('takes every colour and font from the theme, never a literal', () => {
    expect(kitSources.length).toBeGreaterThan(5)
    for (const [file, source] of kitSources) {
      // A hex or an `rgb()` anywhere in a class list is a colour that no longer follows the theme —
      // and one that the Dark values would never reach.
      for (const [, list] of source.matchAll(/'([^']*)'|String\.raw`([^`]*)`/g)) {
        expect(list ?? '', file).not.toMatch(/#[0-9a-f]{3,8}\b/i)
        expect(list ?? '', file).not.toMatch(/\brgba?\(/)
      }
      // The two families are `font-sans` and `font-code`; a literal stack is neither.
      expect(source, file).not.toMatch(/font-\[[^\]]*(Inter|JetBrains|monospace)/)
    }
  })

  it('gives Search a filled tone for a panel’s own filter, flat where the pill is outlined', () => {
    const outline = renderToStaticMarkup(<Search placeholder="Find a file" />)
    const filled = renderToStaticMarkup(<Search tone="filled" placeholder="Find a file" />)

    expect(outline).toContain('data-control="search"')
    expect(outline).toContain('data-tone="outline"')
    expect(filled).toContain('data-tone="filled"')

    // Short, flat and solid: the frame's field has no stroke and is not a pill (ZNpqJ), and it is
    // the same box focused, so only the ring grows.
    const box = /class="([^"]*)"/.exec(filled.slice(filled.indexOf('data-control="search"')))![1]!
    for (const utility of ['h-32', 'border-0', 'rounded-sm', 'bg-secondary', 'px-10', 'py-0'])
      expect(box.split(' ')).toContain(utility)
    expect(box).toContain('focus-within:h-32')
    expect(box).not.toContain('rounded-full')
  })

  it('renders real, accessible controls', () => {
    const button = renderToStaticMarkup(
      <Button variant="primary" icon={Plus} disabled>
        New
      </Button>,
    )
    expect(button).toMatch(/^<button[^>]*type="button"[^>]*disabled/)
    expect(button).toContain('<svg')

    const toggle = renderToStaticMarkup(<Toggle label="Dark mode" checked onChange={() => {}} />)
    expect(toggle).toMatch(/<input[^>]*type="checkbox"[^>]*role="switch"[^>]*checked/)
    expect(toggle).toContain('Dark mode')

    // A control labelled elsewhere draws no empty label: the slot would still take the 10px gap.
    // Each of these is rendered on its own, never as siblings, so none of them wants a `key`.
    // biome-ignore-start lint/correctness/useJsxKeyInIterable: not a list React renders
    for (const bare of [
      <Toggle label={null} aria-label="Play a sound" checked={false} onChange={() => {}} />,
      <Checkbox label={null} aria-label="Notify" checked={false} onChange={() => {}} />,
      <Radio label={null} aria-label="One" checked={false} onChange={() => {}} />,
      // biome-ignore-end lint/correctness/useJsxKeyInIterable: not a list React renders
    ]) {
      expect(renderToStaticMarkup(bare)).not.toContain('data-slot="choice-label"')
    }
    // Nor does a field: an empty label box still takes the field's gap above the control.
    const bareSelect = renderToStaticMarkup(
      <Select label={null} aria-label="Clear this status" options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />,
    )
    expect(bareSelect).not.toContain('data-slot="field-label"')
    // Nor a helper line with nothing on it: no frame draws one, and five screens used to cancel
    // it by hand. A control with no helper is described by nothing rather than by an empty box.
    expect(bareSelect).not.toContain('data-slot="field-helper"')
    expect(bareSelect).not.toContain('aria-describedby')

    const helped = renderToStaticMarkup(<InputGroup label="Key" helper="Two letters." onChange={() => {}} value="" />)
    expect(helped).toMatch(/<input[^>]*aria-describedby="([^"]+)"/)
    expect(helped).toMatch(/<div data-slot="field-helper" class="[^"]*" id="([^"]+)">Two letters\.<\/div>/)

    const checkbox = renderToStaticMarkup(<Checkbox label="Notify" checked={false} onChange={() => {}} />)
    expect(checkbox).toMatch(/<label[^>]*>.*<input[^>]*type="checkbox"/)

    const field = renderToStaticMarkup(<InputGroup label="Name" helper="Taken" error value="x" onChange={() => {}} />)
    expect(field).toMatch(/<label[^>]*for="([^"]+)".*<input[^>]*id="\1"/)
    expect(field).toContain('aria-invalid="true"')

    const tabs = renderToStaticMarkup(
      <Tabs
        items={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
        value="b"
        onChange={() => {}}
      />,
    )
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toMatch(/aria-selected="true"[^>]*>B</)
  })

  it('gives Select a leading icon, as Input Group has, and the error alert instead', () => {
    const options = [{ value: 'managed', label: 'Managed' }]
    const plain = renderToStaticMarkup(
      <Select label="Autonomy" options={options} value="managed" onChange={() => {}} />,
    )
    // Only the chevron: nothing leads the value without an icon.
    expect(plain.match(/<svg/g)).toHaveLength(1)

    const withIcon = renderToStaticMarkup(
      <Select label="Autonomy" icon={ShieldCheck} options={options} value="managed" onChange={() => {}} />,
    )
    expect(withIcon.match(/<svg/g)).toHaveLength(2)
    expect(withIcon).toMatch(/lucide-shield-check[^>]*data-slot="field-icon"[^>]*>.*<select/s)

    const broken = renderToStaticMarkup(
      <Select label="Autonomy" icon={ShieldCheck} error options={options} value="managed" onChange={() => {}} />,
    )
    expect(broken).toContain('data-error="true"')
    expect(broken).toContain('lucide-circle-alert')
    expect(broken).not.toContain('lucide-shield-check')
  })

  it('renders badges with a status dot and avatars with initials', () => {
    expect(renderToStaticMarkup(<Badge variant="success">Shipped</Badge>)).toContain('data-slot="badge-dot"')
    expect(renderToStaticMarkup(<Badge variant="count">7</Badge>)).not.toContain('data-slot="badge-dot"')
    // The row frames' tighter pill drops the dot with the size (T152).
    const small = renderToStaticMarkup(
      <Badge variant="primary" size="sm">
        Needs review
      </Badge>,
    )
    expect(small).toContain('data-size="sm"')
    expect(small).not.toContain('data-slot="badge-dot"')
    expect(renderToStaticMarkup(<Avatar name="Yuri Miguel" />)).toContain('>YM<')
    expect(initialsOf('Ana Souza')).toBe('AS')
    expect(initialsOf('nova')).toBe('NO')
    expect(initialsOf('  ')).toBe('?')
  })
})
