import {
  BookOpen,
  Download,
  FileText,
  FolderOpen,
  KeyRound,
  KeySquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  importButtonLabel,
  importCountLine,
  importNote,
  importSecretLine,
  MCP_IMPORT_PROVIDERS,
  MCP_IMPORT_SUB,
  type McpImportCandidate,
  type McpImportPreview,
  mcpImportEmpty,
  mcpImportNote,
} from '../../../shared/catalogue/mcp-import'
import { presetForServer } from '../../../shared/catalogue/mcp-presets'
import {
  holdersLine,
  MCP_CARD_SUB,
  MCP_TRANSPORTS,
  type McpServerImpact,
  type McpServerRow,
  type McpTransport,
  mcpTarget,
  removalLine,
  secretLine,
  stdioWarning,
} from '../../../shared/catalogue/mcp-servers'
import { INTEGRATIONS_SEARCH_PLACEHOLDER, integrationsCountLine } from '../../../shared/catalogue/skill-sources'
import {
  MISSING_FOLDER_LINE,
  nameFromPath,
  SKILL_TRUST_WARNING,
  SKILLS_CARD_SUB,
  type SkillImpact,
  type SkillInput,
  type SkillRow,
  skillHoldersLine,
  skillProblems,
  skillRemovalLine,
} from '../../../shared/catalogue/skills'
import { PROVIDER_LABEL, type Provider } from '../../../shared/domain/providers'
import type { Result } from '../../../shared/domain/result'
import { hostPlatform } from '../chrome'
import { tildePath } from '../paths'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  cx,
  DropdownMenu,
  InputGroup,
  MenuItem,
  PresetMark,
  Search,
  Select,
  SettingsCard,
  Textarea,
} from '../ui'
import { McpFoundCard } from './McpFound'
import { McpPresetsCard } from './McpPresets'
import { blankDraft, canSave, draftOf, draftProblems, type McpDraft, mcpInput, secretHelper } from './mcp-form-model'
import {
  LIST,
  Modal,
  NONE,
  NOTE,
  ROW_BASE,
  ROW_EDGE,
  ROW_HEAD,
  ROW_NAME,
  ROW_NAME_OFF,
  ROW_NOTE,
  ROW_SECRETS,
  ROW_TARGET,
  ROW_TEXT,
} from './mcp-parts'
import { SkillsFoundCard } from './SkillsFound'
import '../ui/tailwind.css'
import { COLUMN, FIELD_MONO } from './settings-classes'

/*
 * Company settings › Integrations (frames `uApL8`, `mPqN9`): the three sections the tab is made
 * of — what this Company has, what is already on this machine and what can be set up in one step
 * — with the Skills card beside them. The row's own boxes and the modal are in `mcp-parts`.
 */

/** A skill whose folder has moved outlines itself in amber, and says so under its path. */
const ROW_EDGE_MISSING = 'border-status-warning-foreground'
const ROW_TARGET_GONE =
  'overflow-hidden text-ellipsis whitespace-nowrap font-code text-11-5/15 text-muted-foreground line-through'

const ROW_FACTS = 'flex shrink-0 flex-col items-end gap-3 text-11-5/14 text-muted-foreground'
const ROW_SECRET = 'text-11/13'
const ROW_MENU = 'relative shrink-0'

/*
 * The frame draws a bare 16px ellipsis at the row's padding edge; the 26px hit area overhangs it
 * by 5px each way instead of pushing it 5px further in. `p-0` because this is a `<button>` and
 * `ui/tailwind.css` leaves the UA's padding alone.
 */
export const ROW_MORE =
  '-m-5 flex size-26 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground hover:bg-secondary hover:text-foreground'

const ROW_DROPDOWN = 'absolute top-28 right-0 z-20 min-w-150'

/* The tab itself (T242, frame `mPqN9`): one search over three sections, then the two columns. */

/** The tab is the container's only row, the way Add-ons is, so it lays out its own columns. */
const TAB = 'flex min-w-0 grow basis-full flex-col gap-14'
const TOOLBAR = 'flex items-center justify-between gap-16'
const COLUMNS = 'flex min-w-0 items-start gap-16'
const TAB_COUNT = 'shrink-0 text-11-5/14 text-muted-foreground'

/**
 * The kit's Search is a 40px pill; the frame draws this one as a 36px rounded field, the same way
 * Add-ons does (T206) — it sits over a list of cards rather than in a filter bar. The reach names
 * the part by its `data-slot`, and the focused padding is written out beside the resting one
 * because the kit's own `focus-within:px-12` is a two-part selector too, so only the last one
 * stated wins.
 */
const SEARCH_FIELD =
  'grow-0 basis-420 [&_[data-slot=field-control]]:h-36 [&_[data-slot=field-control]]:rounded-sm [&_[data-slot=field-control]]:p-[0_13px] [&_[data-slot=field-control]]:focus-within:p-[0_13px]'

/* The import dialog (T235, frame `qSIIY`). */

/** The two buttons under the MCP card sit on one line, the way the frame's Actions row does. */
const CARD_ACTIONS = 'flex items-center gap-8 self-start'

/** Where the import read, in mono, with what it found at the other end of the line. */
const IMPORT_SOURCE = 'flex items-center gap-8'
const IMPORT_PATH = 'overflow-hidden text-ellipsis whitespace-nowrap font-code text-11-5/15 text-muted-foreground'
const IMPORT_COUNT = 'ml-auto shrink-0 text-11/13 text-muted-foreground'

/** The strip under the list: where the values go, and what is left where it is. */
const IMPORT_FOOT_NOTE = 'flex items-center gap-8 rounded-sm bg-muted px-12 py-10'
const IMPORT_FOOT_TEXT = 'm-0 text-11-5/[1.45] text-muted-foreground'

/** The Skills card (T137, frame `uApL8`): a book mark in front of the name. */
const SKILL_MARK = 'shrink-0 text-muted-foreground'
const SKILL_GONE = 'text-status-warning-foreground'

/** The folder field and its picker side by side; the button sits on the field's own line. */
const SKILL_FOLDER = 'flex items-start gap-8'
const SKILL_FOLDER_INPUT = 'min-w-0 flex-[1_1_auto]'
const SKILL_FOLDER_PICK = 'mt-21 shrink-0'

const api = () => window.tinyCorp

/*
 * The import's two calls, at module scope so the dialog's effect has a dependency that does not
 * change between renders. A test hands in its own pair.
 */
const scanProvider = (provider: Provider) => api().mcp.importScan(provider)
const importFromProvider = (provider: Provider, names: string[]) => api().mcp.importServers(provider, names)

/**
 * Company settings → Integrations (T136, frame `uApL8`): the Company's own catalogue of MCP
 * servers, a row each with its transport, where it is, whether its token is in this machine's own
 * secret store and
 * how many Employees hold it.
 *
 * Adding, editing and removing one is the boss's alone — no MCP tool reaches this — and nothing
 * here reads a Provider's own config on this Mac to discover a server. The catalogue is typed in
 * once, and it is the whole of what an Employee can be given.
 *
 * Beside it, the Skills card (T137): the folders of instructions an Employee opens when the work
 * calls for them. TinyCorp stores the path and never copies the folder in, never parses it and
 * never runs anything in it.
 */
export function IntegrationsTab() {
  const [servers, setServers] = useState<McpServerRow[] | null>(null)
  const [editing, setEditing] = useState<{ server: McpServerRow | null } | null>(null)
  const [importing, setImporting] = useState<Provider | null>(null)
  const [query, setQuery] = useState('')
  /** How many servers the machine scan found, for the count line over the three sections. */
  const [found, setFound] = useState(0)
  /** How many skill folders the machine scan found, for the same line (T253). */
  const [foundSkills, setFoundSkills] = useState(0)
  const [removing, setRemoving] = useState<{ server: McpServerRow; impact: McpServerImpact } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const read = async () => {
      const result = await api().mcp.list()
      if (result.ok) setServers(result.value)
    }
    void read()
    return api().mcp.onChanged(() => void read())
  }, [])

  async function run(action: Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> {
    const result = await action
    setError(result.ok ? null : result.error)
    return result.ok
  }

  async function askRemove(server: McpServerRow) {
    const impact = await api().mcp.impact(server.id)
    if (impact.ok) setRemoving({ server, impact: impact.value })
    else setError(impact.error)
  }

  const shown = (servers ?? []).filter((server) => companyMatches(server, query))

  return (
    <div className={TAB}>
      <div className={TOOLBAR}>
        <Search
          className={SEARCH_FIELD}
          placeholder={INTEGRATIONS_SEARCH_PLACEHOLDER}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className={TAB_COUNT}>{integrationsCountLine(servers?.length ?? 0, found, foundSkills)}</span>
      </div>
      <div className={COLUMNS}>
        <div className={COLUMN}>
          <SettingsCard title="In this Company" sub={MCP_CARD_SUB}>
            {/* A Company with no servers reads the invitation the frame writes under the head
                (`o9BFgz`), as a card row of its own rather than a third line of the subtitle. */}
            {servers?.length === 0 && (
              <p className={NONE}>
                Add one and choose which Employees get it. Nothing from your own config is handed over.
              </p>
            )}
            {error && <Alert variant="error" title={error} onClose={() => setError(null)} />}
            {shown.length > 0 && (
              <div className={LIST}>
                {shown.map((server) => (
                  <ServerRow
                    key={server.id}
                    server={server}
                    onEdit={() => setEditing({ server })}
                    onRemove={() => void askRemove(server)}
                  />
                ))}
              </div>
            )}
            <div className={CARD_ACTIONS}>
              <Button variant="outline" icon={Plus} onClick={() => setEditing({ server: null })}>
                Add an MCP server
              </Button>
              {/* Found on this machine adds one server at a time; this is still the way to tick
                  several at once, from the one Provider whose config TinyCorp can read (T235). */}
              {MCP_IMPORT_PROVIDERS.map((provider) => (
                <Button key={provider} variant="outline" icon={Download} onClick={() => setImporting(provider)}>
                  Import from {PROVIDER_LABEL[provider]}
                </Button>
              ))}
            </div>
          </SettingsCard>
          {/* What the boss already has, read from the six configs on this machine (T242). */}
          <McpFoundCard query={query} onCount={setFound} />
        </div>
        <div className={COLUMN}>
          <SkillsCard />
          {/* The skill folders the agents on this machine already read (T253). */}
          <SkillsFoundCard query={query} onCount={setFoundSkills} />
          <SettingsCard
            title="Who gets what"
            sub="A role hands its tools to every Employee hired into it, and an Employee can be given more or fewer of its own — the same way persona, capabilities and repositories already work. Nothing reaches a Session that is not on its list."
          ></SettingsCard>
          {/* The servers worth having, set up in one step (T242). */}
          <McpPresetsCard query={query} taken={(servers ?? []).map((server) => server.name)} />
        </div>
      </div>
      {editing && (
        <McpServerForm
          server={editing.server}
          servers={servers ?? []}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            const saved = editing.server
              ? await run(api().mcp.update(editing.server.id, input))
              : await run(api().mcp.add(input))
            if (saved) setEditing(null)
          }}
        />
      )}
      {importing && <McpImportDialog provider={importing} onClose={() => setImporting(null)} />}
      {removing && (
        <ConfirmRemoval
          impact={removing.impact}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            if (await run(api().mcp.remove(removing.server.id))) setRemoving(null)
          }}
        />
      )}
    </div>
  )
}

/** What the search field matches on a catalogue row: its name and where it is. */
function companyMatches(server: McpServerRow, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  if (!wanted) return true
  return `${server.name} ${mcpTarget(server)}`.toLowerCase().includes(wanted)
}

/** One catalogue row: name, transport badge, where it is, its secret and who holds it. */
function ServerRow({ server, onEdit, onRemove }: { server: McpServerRow; onEdit(): void; onRemove(): void }) {
  const [menu, setMenu] = useState(false)
  // A row that is one of the presets carries that service's logo (T246). A row the boss typed in,
  // or renamed away from the preset's own name, is the plain row it was.
  const preset = presetForServer(server.name)
  return (
    <div className={cx(ROW_BASE, ROW_EDGE)} data-ui="MCP server">
      <div className={ROW_TEXT}>
        <div className={ROW_HEAD}>
          {preset && <PresetMark preset={preset} size={14} />}
          <span className={ROW_NAME}>{server.name}</span>
          <Badge variant="neutral">{server.transport}</Badge>
        </div>
        <div className={ROW_TARGET}>{mcpTarget(server)}</div>
      </div>
      <div className={ROW_FACTS}>
        <span data-ui="Holders">{holdersLine(server.employees)}</span>
        <span className={ROW_SECRET}>{secretLine(server, hostPlatform())}</span>
      </div>
      <div className={ROW_MENU}>
        <button
          type="button"
          className={ROW_MORE}
          aria-label={`More for ${server.name}`}
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
        {menu && (
          <DropdownMenu className={ROW_DROPDOWN} onMouseLeave={() => setMenu(false)}>
            <MenuItem
              icon={Pencil}
              label="Edit…"
              onClick={() => {
                setMenu(false)
                onEdit()
              }}
            />
            <MenuItem
              icon={Trash2}
              label="Remove…"
              destructive
              onClick={() => {
                setMenu(false)
                onRemove()
              }}
            />
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

/** Add or edit a server. A `stdio` server says plainly that it is a command this Mac will run. */
export function McpServerForm({
  server,
  servers,
  onSave,
  onCancel,
}: {
  server: McpServerRow | null
  servers: McpServerRow[]
  onSave(input: ReturnType<typeof mcpInput>): void
  onCancel(): void
}) {
  const [draft, setDraft] = useState<McpDraft>(() => (server ? draftOf(server) : blankDraft()))
  const set = <F extends keyof McpDraft>(field: F, value: McpDraft[F]) =>
    setDraft((current) => ({ ...current, [field]: value }))
  const problems = draftProblems(draft, servers, server?.id)
  const ready = canSave(draft, servers, server?.id)

  return (
    <Modal
      title={server ? `Edit ${server.name}` : 'Add an MCP server'}
      sub="Its tools reach only the Employees you give it to."
      submit={server ? 'Save server' : 'Add server'}
      ready={ready}
      onCancel={onCancel}
      onSubmit={() => onSave(mcpInput(draft))}
    >
      <InputGroup
        label="Name"
        autoFocus
        value={draft.name}
        error={problems.name !== undefined}
        helper={problems.name ?? 'Lower case, no spaces — it is the name the Employee sees its tools under.'}
        onChange={(e) => set('name', e.target.value)}
      />
      <Select
        label="Transport"
        value={draft.transport}
        options={MCP_TRANSPORTS.map((transport) => ({ value: transport, label: TRANSPORT_LABEL[transport] }))}
        onChange={(e) => set('transport', e.target.value as McpTransport)}
      />
      {draft.transport === 'http' ? (
        <InputGroup
          label="URL"
          className={FIELD_MONO}
          spellCheck={false}
          value={draft.url}
          error={problems.url !== undefined}
          helper={problems.url}
          placeholder="https://mcp.example.com/mcp"
          onChange={(e) => set('url', e.target.value)}
        />
      ) : (
        <>
          <Alert variant="warning" title="This runs a command on your Mac">
            {stdioWarning(hostPlatform())}
          </Alert>
          <InputGroup
            label="Command"
            className={FIELD_MONO}
            spellCheck={false}
            value={draft.command}
            error={problems.command !== undefined}
            helper={problems.command ?? 'The command and its arguments, e.g. npx @playwright/mcp@latest'}
            onChange={(e) => set('command', e.target.value)}
          />
          <Textarea
            label="Environment"
            className={FIELD_MONO}
            rows={3}
            spellCheck={false}
            value={draft.env}
            helper="NAME=value, one per line. Nothing secret — that goes below."
            onChange={(e) => set('env', e.target.value)}
          />
          <InputGroup
            label="Token variable"
            className={FIELD_MONO}
            spellCheck={false}
            value={draft.secretEnv}
            error={problems.secretEnv !== undefined}
            helper={problems.secretEnv ?? 'The variable the token below arrives under, e.g. GITHUB_TOKEN.'}
            onChange={(e) => set('secretEnv', e.target.value)}
          />
        </>
      )}
      <InputGroup
        label="Token"
        type="password"
        icon={KeyRound}
        autoComplete="off"
        value={draft.secret}
        placeholder={draft.keepSecret ? '••••••••' : ''}
        helper={secretHelper(draft)}
        onChange={(e) => setDraft((current) => ({ ...current, secret: e.target.value, keepSecret: false }))}
      />
      {draft.keepSecret && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => set('keepSecret', false)}>
          Forget the stored token
        </Button>
      )}
    </Modal>
  )
}

/**
 * Import from a Provider the boss already uses (T235, frame `qSIIY`): the MCP servers in their own
 * config, listed by name, with the ones this Company does not have already ticked.
 *
 * **Nothing in here is ever a value.** The scan is read in the main process and the preview
 * carries names only — the variables a server takes, not what they are set to — and Import sends
 * back the names that were ticked. The values go from that process to the OS secret store without
 * this screen ever having one, the way the Import .env preview works (T176).
 */
export function McpImportDialog({
  provider,
  onClose,
  scan = scanProvider,
  importServers = importFromProvider,
}: {
  /** Whose config is read. Its name comes from the Provider catalogue, never from this screen. */
  provider: Provider
  onClose(): void
  /** The scan and the import. Injected in the tests and the capture, which have no main process. */
  scan?(provider: Provider): Promise<Result<McpImportPreview>>
  importServers?(provider: Provider, names: string[]): Promise<Result<McpServerRow[]>>
}) {
  const [preview, setPreview] = useState<McpImportPreview | null>(null)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const result = await scan(provider)
      if (!live) return
      if (result.ok) {
        setPreview(result.value)
        setChosen(result.value.servers.filter((server) => server.chosen).map((server) => server.name))
      } else setError(result.error)
    })()
    return () => {
      live = false
    }
    // The scan runs once, when the dialog opens: a second one would replace the values the main
    // process is holding for the Import this one is about to send.
  }, [scan, provider])

  const toggle = (name: string) =>
    setChosen((held) => (held.includes(name) ? held.filter((other) => other !== name) : [...held, name]))

  async function run() {
    const result = await importServers(provider, [...chosen])
    if (result.ok) onClose()
    else setError(result.error)
  }

  return (
    <Modal
      title={`Import from ${PROVIDER_LABEL[provider]}`}
      sub={MCP_IMPORT_SUB}
      submit={importButtonLabel(chosen.length)}
      mark={<Download size={16} aria-hidden />}
      ready={chosen.length > 0}
      onCancel={onClose}
      onSubmit={() => void run()}
    >
      {error && <Alert variant="error" title={error} onClose={() => setError(null)} />}
      {preview && (
        <div className={IMPORT_SOURCE}>
          <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className={IMPORT_PATH} title={preview.path}>
            {tildePath(preview.path)}
          </span>
          <span className={IMPORT_COUNT}>{importCountLine(preview.servers.length)}</span>
        </div>
      )}
      {preview?.servers.length === 0 && <p className={NOTE}>{mcpImportEmpty(PROVIDER_LABEL[preview.source])}</p>}
      {preview && preview.servers.length > 0 && (
        <>
          <div className={LIST}>
            {preview.servers.map((candidate) => (
              <ImportRow
                key={candidate.name}
                candidate={candidate}
                chosen={chosen.includes(candidate.name)}
                onToggle={() => toggle(candidate.name)}
              />
            ))}
          </div>
          <div className={IMPORT_FOOT_NOTE}>
            <KeySquare size={13} className="shrink-0 text-muted-foreground" aria-hidden />
            <p className={IMPORT_FOOT_TEXT}>{mcpImportNote(hostPlatform())}</p>
          </div>
        </>
      )}
    </Modal>
  )
}

/** One candidate: what it is, where it runs, which variables it takes, and why it cannot come. */
function ImportRow({
  candidate,
  chosen,
  onToggle,
}: {
  candidate: McpImportCandidate
  chosen: boolean
  onToggle(): void
}) {
  const secrets = importSecretLine(candidate, hostPlatform())
  const note = importNote(candidate, hostPlatform())
  return (
    <div className={cx(ROW_BASE, ROW_EDGE)} data-ui="Import candidate">
      <Checkbox
        label={null}
        aria-label={candidate.name}
        checked={chosen}
        disabled={candidate.problem !== null}
        onChange={onToggle}
      />
      <div className={ROW_TEXT}>
        <div className={ROW_HEAD}>
          <span className={candidate.problem === null ? ROW_NAME : ROW_NAME_OFF}>{candidate.name}</span>
          <Badge variant="neutral">{candidate.transport}</Badge>
        </div>
        <div className={ROW_TARGET} title={candidate.target}>
          {candidate.target}
        </div>
        {secrets && <div className={ROW_SECRETS}>{secrets}</div>}
      </div>
      {note && <span className={ROW_NOTE}>{note}</span>}
    </div>
  )
}

/** Removing a server says how many Employees and roles lose it, before it does anything. */
function ConfirmRemoval({
  impact,
  onConfirm,
  onCancel,
}: {
  impact: McpServerImpact
  onConfirm(): void
  onCancel(): void
}) {
  return (
    <Modal
      title={`Remove ${impact.name}?`}
      sub="Its token is forgotten with it."
      submit={`Remove ${impact.name}`}
      destructive
      ready
      onCancel={onCancel}
      onSubmit={onConfirm}
    >
      <p className={NOTE}>{removalLine(impact)}</p>
    </Modal>
  )
}

/**
 * The Skills card (T137, frame `uApL8`): a row per skill folder — its name, its path in mono, and
 * who gets it. The folder is picked with the folder picker and never copied in; a folder that has
 * moved or been deleted says so on its row, and the Employees holding it start without it.
 */
function SkillsCard() {
  const [skills, setSkills] = useState<SkillRow[] | null>(null)
  const [editing, setEditing] = useState<{ skill: SkillRow | null } | null>(null)
  const [removing, setRemoving] = useState<{ skill: SkillRow; impact: SkillImpact } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const read = async () => {
      const result = await api().skills.list()
      if (result.ok) setSkills(result.value)
    }
    void read()
    return api().skills.onChanged(() => void read())
  }, [])

  async function run(action: Promise<{ ok: true } | { ok: false; error: string }>): Promise<boolean> {
    const result = await action
    setError(result.ok ? null : result.error)
    return result.ok
  }

  async function askRemove(skill: SkillRow) {
    const impact = await api().skills.impact(skill.id)
    if (impact.ok) setRemoving({ skill, impact: impact.value })
    else setError(impact.error)
  }

  return (
    <>
      <SettingsCard title="Skills" sub={SKILLS_CARD_SUB}>
        {skills?.length === 0 && (
          <p className={NONE}>Add a folder of instructions and choose which Employees can open it.</p>
        )}
        {error && <Alert variant="error" title={error} onClose={() => setError(null)} />}
        {skills && skills.length > 0 && (
          <div className={LIST}>
            {skills.map((skill) => (
              <SkillRowView
                key={skill.id}
                skill={skill}
                onEdit={() => setEditing({ skill })}
                onRemove={() => void askRemove(skill)}
              />
            ))}
          </div>
        )}
        <Button variant="outline" icon={Plus} className="self-start" onClick={() => setEditing({ skill: null })}>
          Add a skill folder
        </Button>
      </SettingsCard>
      {editing && (
        <SkillForm
          skill={editing.skill}
          skills={skills ?? []}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            const saved = editing.skill
              ? await run(api().skills.update(editing.skill.id, input))
              : await run(api().skills.add(input))
            if (saved) setEditing(null)
          }}
        />
      )}
      {removing && (
        <ConfirmSkillRemoval
          impact={removing.impact}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            if (await run(api().skills.remove(removing.skill.id))) setRemoving(null)
          }}
        />
      )}
    </>
  )
}

/** One skill row: the book mark, the name, the folder in mono, and who gets it. */
function SkillRowView({ skill, onEdit, onRemove }: { skill: SkillRow; onEdit(): void; onRemove(): void }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className={cx(ROW_BASE, skill.missing ? ROW_EDGE_MISSING : ROW_EDGE)} data-ui="Skill">
      <BookOpen size={15} className={SKILL_MARK} aria-hidden />
      <div className={ROW_TEXT}>
        <div className={ROW_HEAD}>
          <span className={ROW_NAME}>{skill.name}</span>
        </div>
        <div className={skill.missing ? ROW_TARGET_GONE : ROW_TARGET} title={skill.path}>
          {tildePath(skill.path)}
        </div>
      </div>
      <div className={ROW_FACTS}>
        <span data-ui="Holders">{skillHoldersLine(skill.employees)}</span>
        {skill.missing && <span className={SKILL_GONE}>{MISSING_FOLDER_LINE}</span>}
      </div>
      <div className={ROW_MENU}>
        <button
          type="button"
          className={ROW_MORE}
          aria-label={`More for ${skill.name}`}
          aria-expanded={menu}
          onClick={() => setMenu((open) => !open)}
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
        {menu && (
          <DropdownMenu className={ROW_DROPDOWN} onMouseLeave={() => setMenu(false)}>
            <MenuItem
              icon={Pencil}
              label="Edit…"
              onClick={() => {
                setMenu(false)
                onEdit()
              }}
            />
            <MenuItem
              icon={Trash2}
              label="Remove…"
              destructive
              onClick={() => {
                setMenu(false)
                onRemove()
              }}
            />
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

/**
 * Add or edit a skill. The folder comes from the picker, and the form says plainly that where it
 * came from matters: a skill is instructions, and instructions steer an Employee.
 */
export function SkillForm({
  skill,
  skills,
  onSave,
  onCancel,
  pickFolder = () => api().skills.pickFolder(),
}: {
  skill: SkillRow | null
  skills: SkillRow[]
  onSave(input: SkillInput): void
  onCancel(): void
  /** The folder picker. Injected in the tests, which have no Electron dialog. */
  pickFolder?(): Promise<string | null>
}) {
  const [name, setName] = useState(skill?.name ?? '')
  const [path, setPath] = useState(skill?.path ?? '')
  const taken = skills.filter((other) => other.id !== skill?.id).map((other) => other.name)
  const problems = skillProblems({ name, path }, taken)
  const ready = Object.keys(problems).length === 0

  async function choose() {
    const chosen = await pickFolder()
    if (chosen === null) return
    setPath(chosen)
    // The folder's own name, unless the boss has already written one.
    if (name.trim() === '') setName(nameFromPath(chosen))
  }

  return (
    <Modal
      title={skill ? `Edit ${skill.name}` : 'Add a skill folder'}
      sub="Its instructions reach only the Employees you give it to."
      submit={skill ? 'Save skill' : 'Add skill'}
      ready={ready}
      mark={<BookOpen size={16} aria-hidden />}
      onCancel={onCancel}
      onSubmit={() => onSave({ name: name.trim(), path: path.trim() })}
    >
      <Alert variant="warning" title="A skill steers whoever holds it">
        {SKILL_TRUST_WARNING}
      </Alert>
      <div className={SKILL_FOLDER}>
        <InputGroup
          label="Folder"
          className={cx(FIELD_MONO, SKILL_FOLDER_INPUT)}
          spellCheck={false}
          value={path}
          error={problems.path !== undefined}
          helper={problems.path ?? 'The folder stays where it is — TinyCorp links to it, never copies it.'}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button variant="outline" icon={FolderOpen} className={SKILL_FOLDER_PICK} onClick={() => void choose()}>
          Choose…
        </Button>
      </div>
      <InputGroup
        label="Name"
        value={name}
        error={problems.name !== undefined}
        helper={problems.name ?? 'The folder name the Employee sees it under, e.g. review-checklist.'}
        onChange={(e) => setName(e.target.value)}
      />
    </Modal>
  )
}

/** Removing a skill says who loses it, and that the folder itself is left where it is. */
function ConfirmSkillRemoval({
  impact,
  onConfirm,
  onCancel,
}: {
  impact: SkillImpact
  onConfirm(): void
  onCancel(): void
}) {
  return (
    <Modal
      title={`Remove ${impact.name}?`}
      sub="It leaves the catalogue; the folder stays on your Mac."
      submit={`Remove ${impact.name}`}
      destructive
      ready
      mark={<BookOpen size={16} aria-hidden />}
      onCancel={onCancel}
      onSubmit={onConfirm}
    >
      <p className={NOTE}>{skillRemovalLine(impact)}</p>
    </Modal>
  )
}

const TRANSPORT_LABEL: Record<McpTransport, string> = {
  http: 'http — a URL TinyCorp calls',
  stdio: 'stdio — a command TinyCorp runs',
}
