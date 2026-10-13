import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { dmChannelId } from '../../../shared/domain/chat'
import type { Employee } from '../../../shared/domain/staff'
import type { Route } from '../chrome'
import { ContentHeader, TitleBar } from '../chrome'
import { CompanyRail } from './CompanyRail'
import { EMPTY_SHELL_DATA, type ShellData } from './nav-model'
import { Sidebar } from './Sidebar'

const acme: Company = {
  id: 'c1',
  name: 'Acme Labs',
  key: 'AL',
  boss: { name: 'Grace Holt', initials: 'GH' },
  folder: '/work/acme',
  createdAt: '',
}
const zeta: Company = { ...acme, id: 'c2', name: 'Zeta', key: 'ZE', folder: '/work/zeta' }
const noop = () => {}

function sidebar(route: Route, data: Partial<ShellData> = {}, company = acme) {
  const html = renderToStaticMarkup(
    <Sidebar
      company={company}
      companies={[acme, zeta]}
      data={{ ...EMPTY_SHELL_DATA, ...data }}
      route={route}
      onNavigate={noop}
      onSwitch={noop}
      onCreate={noop}
      onOpen={noop}
    />,
  )
  const doc = new DOMParserLike(html)
  return { html, doc }
}

/**
 * Just enough querying for static markup, without a DOM environment. It reads the `data-ui` name a
 * part carries rather than the class it is drawn with: the shell is utilities since T210f, and a
 * class list is not what any of these tests was ever about.
 */
class DOMParserLike {
  constructor(readonly html: string) {}
  texts(ui: string): string[] {
    return [...this.html.matchAll(new RegExp(`data-ui="${ui}"[^>]*>([^<]*)<`, 'g'))].map((m) => m[1] ?? '')
  }

  /** What the kit's Avatar puts inside a tile it is drawing a character in: the initials, until
   *  that character decodes. A tile with no character carries them as its own text. */
  initials(): string[] {
    return [...this.html.matchAll(/data-slot="avatar-initials"[^>]*>([^<]*)</g)].map((m) => m[1] ?? '')
  }
}

describe('Sidebar', () => {
  it('shows the Company, its headcount and autonomy, and the boss in the footer', () => {
    const employees = [{ id: 'e1', name: 'Ada', roleId: 'backend' } as Employee]
    const { doc } = sidebar({ view: 'office' }, { employees, autonomy: 'supervised' })

    expect(doc.texts('Switcher Initials')).toEqual(['AL'])
    expect(doc.texts('Company Name')).toEqual(['Acme Labs'])
    expect(doc.texts('Company Plan')).toEqual(['1 Employee · Supervised'])
    expect(doc.texts('Boss Initials')).toEqual(['GH'])
    expect(doc.texts('Boss Name')).toEqual(['Grace Holt'])
    expect(doc.texts('Boss Status')).toEqual(['Available'])
  })

  // T79: the boss row draws the character they chose and opens Your profile.
  it("draws the boss's own character and their status in the footer", () => {
    const { html, doc } = sidebar(
      { view: 'office' },
      {},
      { ...acme, boss: { name: 'Yuri Miguel', initials: 'YM', handle: 'yuri', sprite: 4, status: 'focused' } },
    )

    expect(html).toContain('data-sprite="4"')
    // Until the sheet decodes the initials stand in, inside the tile the character will fill.
    expect(doc.initials()).toEqual(['YM'])
    expect(doc.texts('Boss Status')).toEqual(['Focused'])
    expect(html).toContain('data-ui="Open Profile"')
  })

  it('marks the boss row while Your profile is open', () => {
    const { html } = sidebar({ view: 'profile' })

    // The footer takes the nav's own active fill while Your profile is open.
    expect(html).toMatch(/bg-secondary"[^>]*data-ui="Drawer Footer"/)
    expect(html).toContain('aria-current="page"')
  })

  it("shows the boss profile from the Company's settings", () => {
    const { doc } = sidebar({ view: 'office' }, {}, { ...acme, boss: { name: 'Yuri Miguel', initials: 'Y' } })

    expect(doc.texts('Boss Initials')).toEqual(['Y'])
    expect(doc.texts('Boss Name')).toEqual(['Yuri Miguel'])
    expect(doc.texts('Boss Status')).toEqual(['Available'])
  })

  it('lists the views with Company settings last and marks the open one', () => {
    const { doc, html } = sidebar({ view: 'board' })

    expect(doc.texts('Nav Label')).toEqual([
      'Office',
      'Chat',
      'Board',
      'My approvals',
      'Blocked',
      'Open PRs',
      'Employees',
      'Repositories',
      'Files',
      'Memory',
      'Activity',
      'Company settings',
    ])
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*aria-expanded="true"/)
  })

  it('expands only the open view, and Office has no children to expand', () => {
    const { html } = sidebar({ view: 'office' })

    expect(html).not.toContain('data-ui="Nav Child"')
    expect(html).not.toContain('lucide-chevron-down')
  })

  it('highlights the picked child and draws the Needs You pill on every line that waits', () => {
    const { doc, html } = sidebar(
      { view: 'chat', channelId: 'tech' },
      {
        channels: [
          { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
          { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
        ],
        unread: { general: 4 },
        needsYou: { general: 2 },
        bossInboxUnread: 2,
      },
    )

    // The Inbox row and the line under it, and nothing on `#tech`, where nothing waits (T251).
    expect(doc.texts('Nav Count')).toEqual(['2', '2'])
    expect(html.match(/data-ui="Nav Count" class="[^"]*bg-destructive/g)).toHaveLength(2)
    expect(html).not.toMatch(/data-ui="Nav Count" class="[^"]*bg-primary/)
    expect(html).toMatch(/data-ui="Nav Child"[^>]*aria-current="page"[^>]*>.*?tech</)
  })

  // T251: a line with anything newer than its read mark reads bold, `#` included.
  it('draws an unread channel bold and leaves a read one in the soft ink', () => {
    const { html } = sidebar(
      { view: 'chat' },
      {
        channels: [
          { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
          { id: 'tech', kind: 'channel', name: 'tech', members: [], topic: '' },
        ],
        unread: { general: 4 },
      },
    )
    const rows = html.split('data-ui="Nav Child"').slice(1)
    const general = rows.find((row) => row.includes('>general<'))!
    const tech = rows.find((row) => row.includes('>tech<'))!

    expect(general).toMatch(/data-ui="Nav Label" class="[^"]*font-bold/)
    // React escapes the `&` of the selector into the attribute, so the class reads `[&amp;_…]`.
    expect(general).toContain('[&amp;_[data-ui=Hash]]:text-foreground')
    expect(tech).toMatch(/data-ui="Nav Label" class="[^"]*font-medium/)
    expect(tech).not.toContain('[&amp;_[data-ui=Hash]]:text-foreground')
  })

  // T251: away from Chat the lines are not on screen, so the row above them carries the count.
  it('carries the whole Inbox count on the Chat row while another view is open', () => {
    const fields = {
      channels: [{ id: 'general', kind: 'channel' as const, name: 'general', members: [], topic: '' }],
      needsYou: { general: 3 },
      bossInboxUnread: 3,
    }
    const away = sidebar({ view: 'office' }, fields)
    const open = sidebar({ view: 'chat' }, fields)

    expect(away.doc.texts('Nav Count')).toEqual(['3'])
    expect(away.html).toMatch(/data-ui="Nav Count" class="[^"]*bg-destructive/)
    // With the lines showing, the Chat row says nothing and they say it instead.
    expect(open.doc.texts('Nav Count')).toEqual(['3', '3'])
  })

  it('lists the boss’s own DMs and nothing of what two Employees say to each other', () => {
    const nova = { id: 'e-nova', name: 'Nova', roleId: 'r', sprite: 2 } as Employee
    const vega = { id: 'e-vega', name: 'Vega', roleId: 'r', sprite: 5 } as Employee
    const between = dmChannelId(nova.id, vega.id)
    const { doc, html } = sidebar(
      { view: 'chat' },
      {
        employees: [nova, vega],
        channels: [{ id: between, kind: 'dm', name: '', members: [nova.id, vega.id], topic: '' }],
        agentPairs: [{ channelId: between, members: [nova.id, vega.id], lastAt: '2026-09-17T09:47:00', unread: 0 }],
      },
    )

    // One section, the boss's own: what Nova and Vega say to each other is theirs (T113).
    expect(doc.texts('Nav Section')).toEqual(['Direct messages'])
    expect(doc.texts('Nav Label')).toContain('Nova')
    expect(doc.texts('Nav Label')).toContain('Vega')
    expect(html).not.toContain('Nova &amp; Vega')
    expect(html).not.toContain('with Vega')
  })

  it('offers a live search, not the readOnly field the design was built with', () => {
    const { html } = sidebar({ view: 'office' })

    expect(html).toContain('placeholder="Search Employees or tickets"')
    expect(html).toContain('role="combobox"')
    expect(html).not.toContain('readonly')
    expect(html).not.toContain('tabindex="-1"')
  })
})

describe('Sidebar role rows', () => {
  it('carry an edit button next to the row', () => {
    const { html } = sidebar(
      { view: 'employees' },
      { roles: [{ id: 'hr', name: 'HR' } as ShellData['roles'][number]], employees: [] },
    )

    expect(html).toMatch(/data-ui="Nav Child"[^>]*>.*?HR<.*?aria-label="Edit role HR"/)
  })
})

describe('Sidebar channel rows (T112)', () => {
  const channels: ShellData['channels'] = [
    { id: 'general', kind: 'channel', name: 'general', members: [], topic: '' },
    { id: 'epic-4-checkout', kind: 'channel', name: 'epic-4-checkout', members: [], topic: '' },
  ]

  it('carry a delete button on a channel of the boss’s own making', () => {
    const { html } = sidebar({ view: 'chat' }, { channels })

    expect(html).toMatch(/data-ui="Nav Child"[^>]*>.*?epic-4-checkout<.*?aria-label="Delete #epic-4-checkout"/)
  })

  it('offer nothing on the Company’s own channels', () => {
    const { html } = sidebar({ view: 'chat' }, { channels })

    expect(html).not.toContain('aria-label="Delete #general"')
  })
})

describe('CompanyRail', () => {
  it('draws one initials tile per Company, the open one marked, and a + at the end', () => {
    const html = renderToStaticMarkup(
      <CompanyRail companies={[acme, zeta]} currentId="c2" onSwitch={noop} onCreate={noop} />,
    )

    expect(new DOMParserLike(html).texts('Company Tile')).toEqual(['AL', 'ZE'])
    expect(html.match(/data-ui="Rail Marker"/g)).toHaveLength(1)
    // The open Company's tile carries the white ring, and says so to a screen reader.
    expect(html).toMatch(/outline-white"[^>]*aria-label="Zeta"[^>]*aria-current="true"/)
    expect(html).toMatch(/aria-label="New Company"[\s\S]*$/)
  })

  it('opens a Company’s actions on a right click on its avatar', () => {
    const opened: [string, { x: number; y: number }][] = []
    const rail = CompanyRail({
      companies: [acme, zeta],
      currentId: 'c1',
      onSwitch: noop,
      onCreate: noop,
      onMenu: (company, anchor) => opened.push([company.id, anchor]),
    })
    const avatar = findByLabel(rail, 'Zeta')
    let prevented = false
    avatar.props.onContextMenu?.({ clientX: 30, clientY: 120, preventDefault: () => (prevented = true) })

    expect(opened).toEqual([['c2', { x: 30, y: 120 }]])
    expect(prevented).toBe(true)
  })

  it('marks what each open Company needs, the one in view included, and nothing on the others (T145)', () => {
    const globex: Company = { ...acme, id: 'c3', name: 'Globex', key: 'GL', folder: '/work/globex' }
    const html = renderToStaticMarkup(
      <CompanyRail
        companies={[acme, zeta, globex]}
        currentId="c1"
        onSwitch={noop}
        onCreate={noop}
        attention={
          new Map([
            ['c1', { companyId: 'c1', waiting: 2, working: false }],
            ['c2', { companyId: 'c2', waiting: 0, working: true }],
          ])
        }
      />,
    )
    const slots = html.split('data-ui="Rail Slot"').slice(1)

    expect(new DOMParserLike(html).texts('Rail Badge')).toEqual(['2'])
    expect(slots[0]).toMatch(/aria-label="Acme Labs, 2 waiting on you"/)
    expect(slots[0]).toMatch(/data-ui="Rail Badge"/)
    // Red, as frame `u9sLao` draws it, and never the app's own indigo accent (T251).
    expect(slots[0]).toMatch(/class="[^"]*bg-destructive[^"]*"[^>]*data-ui="Rail Badge"/)
    expect(slots[0]).not.toMatch(/class="[^"]*bg-primary[^"]*"[^>]*data-ui="Rail Badge"/)
    expect(slots[1]).toMatch(/aria-label="Zeta, working"/)
    expect(slots[1]).toMatch(/data-ui="Rail Working"/)
    expect(slots[1]).not.toMatch(/data-ui="Rail Badge"/)
    expect(slots[2]).toMatch(/aria-label="Globex"/)
    expect(slots[2]).not.toMatch(/data-ui="Rail (Badge|Working)"/)
  })

  it('opens with the inert App Mark, then the divider, then the Companies', () => {
    const html = renderToStaticMarkup(<CompanyRail companies={[acme]} currentId="c1" onSwitch={noop} onCreate={noop} />)

    expect(html).toMatch(
      /^<nav[^>]*><div[^>]*><svg[^>]*data-ui="Logo Icon"[^>]*>.*?<\/svg><\/div><div[^>]*><\/div><div data-ui="Rail Slot"/,
    )
    expect(html).toMatch(/<svg[^>]*width="34"[^>]*height="34"[^>]*viewBox="0 0 160 160"/)
    expect(html).not.toMatch(/shell-rail__mark[^>]*(role|tabindex|onclick)/i)
  })
})

describe('TitleBar', () => {
  it('centres the title between the traffic lights and the window actions', () => {
    const html = renderToStaticMarkup(<TitleBar title="Acme Labs — Board" onToggleMaximize={noop} />)

    expect(html).toContain('data-ui="Traffic Lights"')
    expect(html).toMatch(/<span[^>]*>Acme Labs — Board<\/span>/)
    expect(html).toMatch(/aria-label="Toggle sidebar"[^>]*disabled/)
    expect(html).toContain('aria-label="Maximize"')
  })

  it('carries a quiet notice beside the title, and nothing when there is none', () => {
    const notice = <span className="update-notice">Version 0.4.0 available</span>
    const withNotice = renderToStaticMarkup(<TitleBar title="Acme Labs" notice={notice} onToggleMaximize={noop} />)
    const without = renderToStaticMarkup(<TitleBar title="Acme Labs" onToggleMaximize={noop} />)

    expect(withNotice).toMatch(/data-ui="Window Title"[\s\S]*update-notice/)
    expect(without).not.toContain('update-notice')
  })
})

describe('ContentHeader', () => {
  it('shows the default title and subtitle above the view', () => {
    const html = renderToStaticMarkup(
      <ContentHeader title="Board" subtitle="3 tickets · 1 epic">
        <p>view</p>
      </ContentHeader>,
    )

    expect(new DOMParserLike(html).texts('View Title')).toEqual(['Board'])
    expect(new DOMParserLike(html).texts('View Subtitle')).toEqual(['3 tickets · 1 epic'])
    expect(html).toContain('data-ui="View Actions"')
    expect(html).toMatch(/<\/header><p>view<\/p>$/)
  })
})

interface Node {
  props: {
    children?: unknown
    'aria-label'?: string
    /** The one handler these tests reach for; the rest of an element's props are not read here. */
    onContextMenu?(event: { clientX: number; clientY: number; preventDefault(): void }): void
    [key: string]: unknown
  }
}

/** The element labelled `label` in a rendered tree, found without a DOM. */
function findByLabel(node: unknown, label: string): Node {
  const found = (function walk(n: unknown): Node | null {
    if (Array.isArray(n)) return n.map(walk).find(Boolean) ?? null
    if (!n || typeof n !== 'object' || !('props' in n)) return null
    const element = n as Node
    return element.props['aria-label'] === label ? element : walk(element.props.children)
  })(node)
  if (!found) throw new Error(`no element labelled ${label}`)
  return found
}
