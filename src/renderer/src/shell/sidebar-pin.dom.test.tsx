// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import baseCss from '../ui/tailwind.css?raw'
import { EMPTY_SHELL_DATA } from './nav-model'
import { Sidebar } from './Sidebar'
import sidebarSource from './Sidebar.tsx?raw'

// T147: Company settings is pinned above the footer however long the tree above it grows. It once
// sat inside the scroller behind a flex spacer, so the spacer collapsed at the app's real height and
// one more row pushed the settings row under the fold, with no scrollbar to say it was there.

const company: Company = {
  id: 'c1',
  name: 'Acme Labs',
  key: 'AL',
  boss: { name: 'Grace Holt', initials: 'GH' },
  folder: '/work/acme',
  createdAt: '',
}

/** A Company with enough Employees that the Chat tree is longer than any sidebar. */
function sidebar(): Document {
  const employees = Array.from(
    { length: 30 },
    (_, i) => ({ id: `e${i}`, name: `Emp ${i}`, roleId: 'backend' }) as Employee,
  )
  const channels = employees.map((e) => ({
    id: dmChannelId(BOSS, e.id),
    kind: 'dm' as const,
    name: '',
    members: [BOSS, e.id],
    topic: '',
  }))
  const html = renderToStaticMarkup(
    <Sidebar
      company={company}
      companies={[company]}
      data={{ ...EMPTY_SHELL_DATA, employees, channels }}
      route={{ view: 'chat' }}
      onNavigate={() => {}}
      onSwitch={() => {}}
      onCreate={() => {}}
      onOpen={() => {}}
    />,
  )
  return new DOMParser().parseFromString(html, 'text/html')
}

function label(doc: Document, text: string): Element {
  const found = [...doc.querySelectorAll('[data-ui="Nav Label"]')].find((l) => l.textContent === text)
  expect(found, text).toBeDefined()
  return found!
}

/** One of the drawer's named class lists, by the name it is declared under (T210f). */
function list(name: string): string {
  const found = new RegExp(`^const ${name} =\\s*\\n?\\s*'([^']*)'`, 'm').exec(sidebarSource)
  expect(found, name).not.toBeNull()
  return found?.[1] ?? ''
}

describe('the sidebar nav', () => {
  it('keeps Company settings out of the part that scrolls, still inside the Company nav', () => {
    const doc = sidebar()
    const settings = label(doc, 'Company settings')

    expect(settings.closest('[data-ui="Nav Scroll"]')).toBeNull()
    expect(settings.closest('[data-ui="Nav Pinned"]')).not.toBeNull()
    expect(settings.closest('nav')?.getAttribute('aria-label')).toBe('Company')
  })

  it('scrolls the whole tree, down to its last view and last DM', () => {
    const doc = sidebar()

    for (const text of ['Office', 'Chat', 'Emp 29', 'Board', 'Activity']) {
      expect(label(doc, text).closest('[data-ui="Nav Scroll"]'), text).not.toBeNull()
    }
  })

  it('gives only the tree a scroller, and pins the settings row at its own height', () => {
    // A layout jsdom cannot measure, so the class lists are what is checked: the nav itself and
    // the pinned group never scroll or shrink, which is what let the settings row slide under the
    // fold. The pinned group's list is short enough to be written where it is drawn.
    const doc = sidebar()
    const pinned = doc.querySelector('[data-ui="Nav Pinned"]')?.className ?? ''

    expect(list('NAV_SCROLL')).toContain('overflow-y-auto')
    expect(list('NAV')).not.toContain('overflow')
    expect(pinned).not.toContain('overflow')
    expect(pinned).toContain('shrink-0')
  })

  it('says there is more when the tree overflows, since it draws no scrollbar', () => {
    const scroller = list('NAV_SCROLL')

    expect(scroller).toContain('[scrollbar-width:none]')
    // The edges fade by as much as is left to scroll, driven by the scroller's own position.
    expect(scroller).toContain('[animation-timeline:scroll(self),scroll(self)]')
    expect(scroller).toMatch(/mask-image:[^\]]*--shell-nav-fade-above[^\]]*--shell-nav-fade-below/)
    // The two lengths the mask reads are registered properties, which only a stylesheet can
    // declare, and the keyframes that move them are global by the same rule.
    expect(baseCss).toContain('@property --shell-nav-fade-above')
    expect(baseCss).toContain('@property --shell-nav-fade-below')
    expect(baseCss).toContain('@keyframes shell-nav-more-above')
    expect(baseCss).toContain('@keyframes shell-nav-more-below')
  })
})
