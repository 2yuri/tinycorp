import { Copy, Download, Ellipsis, Folder, FolderOpen, Lock, Pencil, Plus, Share2, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import '../tailwind.css'
import {
  Alert,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  Checkbox,
  DropdownMenu,
  EmptyState,
  IconButton,
  InputGroup,
  MenuDivider,
  MenuItem,
  Progress,
  Radio,
  Search,
  Select,
  Tabs,
  Textarea,
  Toast,
  Toggle,
} from '../kit'

/** Every kit component, in the order the Components page (design/system/RAuoz.png) shows them. */
export const GALLERY_COMPONENTS = [
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

const noop = () => {}

/**
 * The focused field, drawn as the frame draws it: the ring the kit paints on `:focus-visible` is
 * not there in a screenshot, so the gallery puts it on by hand.
 */
const FOCUS_FIELD =
  '[&_[data-slot=field-control]]:border-2 [&_[data-slot=field-control]]:border-ring [&_[data-slot=field-control]]:px-12 [&_[data-slot=field-control]]:py-9 [&_[data-slot=field-control]]:shadow-focus'

function Section({ name, desc, children }: { name: string; desc: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-24">
      <header className="flex flex-col gap-6 border-border border-b pb-15">
        <h2 className="m-0 font-semibold text-22/[normal] text-foreground tracking-[-0.4px]">{name}</h2>
        <p className="m-0 whitespace-nowrap text-14/[normal] text-muted-foreground">{desc}</p>
      </header>
      {children}
    </section>
  )
}

interface PanelProps {
  gap: number
  column?: boolean
  align?: boolean
  /** Equal-width columns ("fill container" siblings with different paddings). */
  columns?: number
  children: ReactNode
}

function Panel({ gap, column, align, columns, children }: PanelProps) {
  const layout = columns
    ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : { flexDirection: column ? ('column' as const) : ('row' as const) }
  return (
    <div
      className="flex rounded-md bg-muted p-24"
      style={{ gap, alignItems: align ? 'center' : 'flex-start', ...layout }}
    >
      {children}
    </div>
  )
}

function Captioned({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-10">
      {children}
      <span className="whitespace-nowrap text-11/[normal] text-muted-foreground">{caption}</span>
    </div>
  )
}

/**
 * Dev-only (`?gallery`, and the capture harness beside this file): renders the kit so it can be
 * compared with the Components page. `theme` seeds the toggle in the corner, so a shot of the dark
 * palette never has to click it.
 */
export function Gallery({ theme: initial = 'light' }: { theme?: 'light' | 'dark' } = {}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(initial)
  const [tab, setTab] = useState('overview')
  const [checks, setChecks] = useState({ notify: true, archive: false, dark: true, digest: false })
  const [visibility, setVisibility] = useState('public')

  return (
    <div className="min-h-screen bg-card text-foreground data-[theme=dark]:bg-background" data-theme={theme}>
      <div className="flex w-1440 flex-col gap-56 p-64 font-sans leading-[normal]">
        <header className="flex flex-col gap-10">
          <div className="font-bold text-12/[normal] text-primary tracking-[2.4px]">BETTER OFFICE</div>
          <h1 className="m-0 font-bold text-56/[normal] text-foreground tracking-[-1.6px]">Components</h1>
          <p className="m-0 w-640 text-17/26 text-muted-foreground">
            Every master below is reusable — instance it, override the labels, never redraw it.
          </p>
        </header>

        <Section
          name="Buttons"
          desc="One primary action per view. Outline for cancel, ghost for inline, destructive only for deletion."
        >
          <Panel gap={16} align>
            <Button variant="primary" icon={Plus}>
              New project
            </Button>
            <Button variant="secondary" icon={Copy}>
              Duplicate
            </Button>
            <Button variant="outline" icon={Download}>
              Export
            </Button>
            <Button variant="ghost" icon={X}>
              Cancel
            </Button>
            <Button variant="destructive" icon={Trash2}>
              Delete
            </Button>
            <IconButton icon={Ellipsis} label="More" />
          </Panel>
          <Panel gap={16} align>
            <Captioned caption="Small">
              <Button size="sm" icon={Plus}>
                New project
              </Button>
            </Captioned>
            <Captioned caption="Default">
              <Button icon={Plus}>New project</Button>
            </Captioned>
            <Captioned caption="Large">
              <Button size="lg" icon={Plus}>
                New project
              </Button>
            </Captioned>
            <Captioned caption="Hover">
              <Button icon={Plus} className="bg-primary-hover">
                New project
              </Button>
            </Captioned>
            <Captioned caption="Disabled">
              <Button icon={Plus} disabled>
                New project
              </Button>
            </Captioned>
            <Captioned caption="Icon only">
              <Button icon={Plus} aria-label="New project" />
            </Captioned>
          </Panel>
        </Section>

        <Section
          name="Badges & Avatars"
          desc="Status is always a pill with a dot. Avatars are pill-round and stack with a 2px surface ring."
        >
          <Panel gap={14} align>
            <Badge variant="neutral">Draft</Badge>
            <Badge variant="primary">In progress</Badge>
            <Badge variant="success">Shipped</Badge>
            <Badge variant="warning">Blocked</Badge>
            <Badge variant="danger">Failing</Badge>
            <Badge variant="count">7</Badge>
          </Panel>
          <Panel gap={16} align>
            <Avatar name="Yuri Miguel" tone="primary" ring />
            <Avatar name="Ana Souza" person={{ id: 'e-ana', sprite: 1 }} ring />
            <Avatar name="Tiny Corp" tone="ink" ring />
            <Avatar name="Lia Reis" person={{ id: 'e-lia', sprite: 2 }} ring />
            <AvatarStack>
              <Avatar name="Yuri Miguel" tone="primary" size={32} ring />
              <Avatar name="Ana Souza" person={{ id: 'e-ana', sprite: 1 }} size={32} ring />
              <Avatar name="Tiny Corp" tone="ink" size={32} ring />
              <Avatar name="4 more" text="+4" tone="neutral" size={32} ring />
            </AvatarStack>
          </Panel>
        </Section>

        <Section
          name="Form Controls"
          desc="Labels sit above the field. Helper text is always reserved so validation never shifts the layout."
        >
          <Panel gap={20}>
            <InputGroup
              label="Project name"
              icon={Folder}
              defaultValue="Atlas rebuild"
              helper="Visible to everyone in the office."
            />
            <InputGroup
              label="Focused"
              icon={Folder}
              defaultValue="Typing…"
              helper="Ring uses --ring at 16% spread."
              className={FOCUS_FIELD}
            />
            <InputGroup label="Error" icon={Folder} defaultValue="bad-input" error helper="Name is already taken." />
            <InputGroup
              label="Disabled"
              icon={Lock}
              value="Locked"
              disabled
              readOnly
              helper="Ask an admin to unlock."
            />
          </Panel>
          <Panel gap={20}>
            <Select
              label="Owner"
              helper="Only one owner per project."
              options={[
                { value: 'ym', label: 'Yuri Miguel' },
                { value: 'as', label: 'Ana Souza' },
              ]}
            />
            <Search
              label="Search"
              placeholder="Search everything…"
              shortcut="⌘K"
              helper="Fuzzy across projects and people."
            />
            <Textarea
              label="Notes"
              placeholder="Standup notes, decisions, anything the team should keep."
              helper="Markdown supported."
            />
          </Panel>
          <Panel gap={40} align>
            <Checkbox
              label="Notify the team"
              checked={checks.notify}
              onChange={(e) => setChecks({ ...checks, notify: e.target.checked })}
            />
            <Checkbox
              label="Archive when done"
              checked={checks.archive}
              onChange={(e) => setChecks({ ...checks, archive: e.target.checked })}
            />
            <Radio
              label="Public"
              name="visibility"
              checked={visibility === 'public'}
              onChange={() => setVisibility('public')}
            />
            <Radio
              label="Private"
              name="visibility"
              checked={visibility === 'private'}
              onChange={() => setVisibility('private')}
            />
            <Toggle
              label="Dark mode"
              checked={checks.dark}
              onChange={(e) => setChecks({ ...checks, dark: e.target.checked })}
            />
            <Toggle
              label="Email digest"
              checked={checks.digest}
              onChange={(e) => setChecks({ ...checks, digest: e.target.checked })}
            />
            <Progress label="Sprint 12" value={68} />
          </Panel>
        </Section>

        <Section
          name="Cards"
          desc="A card holds one idea. Header slot, content slot, actions slot — disable what you don't need."
        >
          <Panel gap={20} columns={3}>
            <Card
              title="Card title"
              description="One sentence explaining what lives in this card."
              actions={
                <>
                  <Button variant="ghost" icon={X}>
                    Cancel
                  </Button>
                  <Button>Save</Button>
                </>
              }
            >
              Content goes here. Keep it to a single idea so the card stays scannable.
            </Card>
          </Panel>
        </Section>

        <Section name="Navigation" desc="Active state is a 2px underline. One tab strip per view, never two.">
          <Panel gap={24}>
            <div className="flex min-w-0 flex-1 flex-col gap-24">
              <Tabs
                items={[
                  { id: 'overview', label: 'Overview' },
                  { id: 'activity', label: 'Activity' },
                  { id: 'files', label: 'Files' },
                  { id: 'members', label: 'Members' },
                  { id: 'settings', label: 'Settings' },
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
          </Panel>
        </Section>

        <Section
          name="Feedback"
          desc="Alerts are inline and tinted. Toasts float on the raised elevation and always carry one action."
        >
          <Panel gap={14} column>
            <Alert variant="info" title="Heads up" onClose={noop}>
              The tiny team works while you sleep. Check the log in the morning.
            </Alert>
            <Alert variant="success" title="Deploy finished" onClose={noop}>
              Atlas rebuild shipped to production in 4m 12s.
            </Alert>
            <Alert variant="warning" title="Approaching limit" onClose={noop}>
              You have used 82% of this month&apos;s compute budget.
            </Alert>
            <Alert variant="error" title="Build failed" onClose={noop}>
              Three tests broke on the last commit. Review the log.
            </Alert>
          </Panel>
          <Panel gap={20} columns={3}>
            <Toast className="min-w-0 flex-1" action={{ label: 'Undo', onClick: noop }}>
              Project saved
            </Toast>
            <DropdownMenu className="min-w-0 flex-1">
              <MenuItem icon={Pencil} label="Rename" shortcut="⌘R" highlighted />
              <MenuItem icon={Copy} label="Duplicate" shortcut="⌘D" />
              <MenuItem icon={Share2} label="Share" shortcut="⌘S" />
              <MenuDivider />
              <MenuItem icon={Trash2} label="Delete" destructive />
            </DropdownMenu>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-20">
              <EmptyState
                icon={FolderOpen}
                title="Nothing here yet"
                body="Start a project and the office gets to work."
                action={<Button icon={Plus}>New project</Button>}
              />
            </div>
          </Panel>
        </Section>
      </div>
      <div className="fixed top-16 right-16 rounded-sm bg-popover px-12 py-8 shadow-menu">
        <Toggle
          label="Dark theme"
          checked={theme === 'dark'}
          onChange={(event) => setTheme(event.target.checked ? 'dark' : 'light')}
        />
      </div>
    </div>
  )
}
