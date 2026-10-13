import { Check, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { McpServerRow } from '../../../shared/catalogue/mcp-servers'
import {
  foundCountLine,
  foundMatches,
  foundNote,
  foundSecretLine,
  foundTotal,
  MCP_FOUND_EMPTY,
  MCP_SOURCE_LABEL,
  type McpFoundGroup,
  type McpFoundServer,
  type McpSource,
  mcpFoundSub,
} from '../../../shared/catalogue/mcp-sources'
import type { Result } from '../../../shared/domain/result'
import { hostPlatform } from '../chrome'
import { tildePath } from '../paths'
import { Alert, Badge, Button, cx, SettingsCard } from '../ui'
import {
  LIST,
  NONE,
  ROW_BASE,
  ROW_EDGE,
  ROW_HEAD,
  ROW_NAME,
  ROW_NOTE,
  ROW_SECRETS,
  ROW_TARGET,
  ROW_TEXT,
} from './mcp-parts'

/*
 * Company settings › Integrations › Found on this machine (T242, frame `mPqN9`).
 *
 * Every Session is spawned with its Provider's strictest MCP flag (T136), so an Employee sees
 * nothing the boss already configured for themselves. This is the shortest way across: when the
 * tab opens, the six tools that keep MCP servers in a file are read and what is in them is one
 * click away. The files are read in the main process and never written, and what arrives here
 * carries names only — no value is ever on this side.
 */

/** The label over one tool's rows: whose config it is, where, and how many it holds. */
const GROUP = 'flex flex-col gap-6'
const GROUP_LABEL = 'flex items-center gap-8'
const GROUP_SOURCE = 'text-10-5/13 font-bold uppercase tracking-[0.5px] text-muted-foreground'
const GROUP_PATH =
  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-code text-10-5/13 text-muted-foreground opacity-80'
const GROUP_COUNT = 'ml-auto shrink-0 text-10-5/13 text-muted-foreground'

const GROUPS = 'flex flex-col gap-12'

/** A row already in the catalogue: a quiet pill in place of the button, so the row never moves. */
const ADDED =
  'flex shrink-0 items-center gap-5 rounded-full bg-secondary px-9 py-3 text-11/13 font-semibold text-muted-foreground'

const api = () => window.tinyCorp

/** The scan and the add, at module scope so the effect's dependency does not change per render. */
const scanMachine = () => api().mcp.found()
const addFoundServer = (source: McpSource, name: string) => api().mcp.addFound(source, name)

export function McpFoundCard({
  query,
  onCount,
  found = scanMachine,
  addFound = addFoundServer,
}: {
  /** The tab's search. A group with nothing left in it is not drawn. */
  query: string
  /** How many servers the scan found, for the tab's count line. */
  onCount(total: number): void
  /** The scan and the add. Injected in the tests and the capture, which have no main process. */
  found?(): Promise<Result<McpFoundGroup[]>>
  addFound?(source: McpSource, name: string): Promise<Result<McpServerRow>>
}) {
  const [groups, setGroups] = useState<McpFoundGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const result = await found()
      if (!live) return
      if (result.ok) setGroups(result.value)
      else setError(result.error)
    })()
    return () => {
      live = false
    }
  }, [found])

  // The count is the whole scan, not what the search has left, so the tab's line stays still
  // while the boss types.
  const total = foundTotal(groups ?? [])
  useEffect(() => {
    onCount(total)
  }, [onCount, total])

  async function add(source: McpSource, name: string) {
    const result = await addFound(source, name)
    if (!result.ok) return setError(result.error)
    setError(null)
    // The catalogue has it now, so the row says so without another trip to the six files.
    setGroups(
      (held) =>
        held?.map((group) => ({
          ...group,
          servers: group.servers.map((server) =>
            group.source === source && server.name === name ? { ...server, added: true } : server,
          ),
        })) ?? null,
    )
  }

  const shown = (groups ?? [])
    .map((group) => ({
      ...group,
      servers: group.servers.filter((server) => foundMatches(server, group.source, query)),
    }))
    .filter((group) => group.servers.length > 0)

  return (
    <SettingsCard title="Found on this machine" sub={mcpFoundSub(hostPlatform())}>
      {error && <Alert variant="error" title={error} onClose={() => setError(null)} />}
      {groups !== null && total === 0 && <p className={NONE}>{MCP_FOUND_EMPTY}</p>}
      {shown.length > 0 && (
        <div className={GROUPS}>
          {shown.map((group) => (
            <div key={group.source} className={GROUP}>
              <div className={GROUP_LABEL}>
                <span className={GROUP_SOURCE}>{MCP_SOURCE_LABEL[group.source]}</span>
                <span className={GROUP_PATH} title={group.path}>
                  {tildePath(group.path)}
                </span>
                <span className={GROUP_COUNT}>{foundCountLine(group.servers)}</span>
              </div>
              <div className={LIST}>
                {group.servers.map((server) => (
                  <FoundRow key={server.name} server={server} onAdd={() => void add(group.source, server.name)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  )
}

/** One found server: what it is, where it runs, which variables it takes, and one button. */
function FoundRow({ server, onAdd }: { server: McpFoundServer; onAdd(): void }) {
  const secrets = foundSecretLine(server, hostPlatform())
  const note = server.added ? '' : foundNote(server, hostPlatform())
  return (
    <div className={cx(ROW_BASE, ROW_EDGE)} data-ui="Found server">
      <div className={ROW_TEXT}>
        <div className={ROW_HEAD}>
          <span className={ROW_NAME}>{server.name}</span>
          <Badge variant="neutral">{server.transport}</Badge>
        </div>
        <div className={ROW_TARGET} title={server.target}>
          {server.target}
        </div>
        {secrets && <div className={ROW_SECRETS}>{secrets}</div>}
      </div>
      {note && <span className={ROW_NOTE}>{note}</span>}
      {server.added ? (
        <span className={ADDED}>
          <Check size={12} aria-hidden />
          Added
        </span>
      ) : (
        server.problem === null && (
          <Button variant="outline" size="sm" icon={Plus} aria-label={`Add ${server.name}`} onClick={onAdd}>
            Add
          </Button>
        )
      )}
    </div>
  )
}
