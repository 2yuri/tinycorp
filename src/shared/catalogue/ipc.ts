import type { Provider } from '../domain/providers'
import type { Result } from '../domain/result'
import type { McpImportPreview } from './mcp-import'
import type { McpServerImpact, McpServerInput, McpServerRow } from './mcp-servers'
import type { McpFoundGroup, McpSource } from './mcp-sources'
import type { SkillFoundGroup } from './skill-sources'
import type { SkillDescribed, SkillImpact, SkillInput, SkillRow } from './skills'

/**
 * The Company's catalogue of outside MCP servers (T136). Adding, editing and removing one is the
 * boss's: no MCP tool reaches this, and no secret ever comes back over it. Exposed as
 * `window.tinyCorp.mcp`.
 */
export interface McpServersApi {
  /** Every server, in catalogue order, with whether it has a secret and how many Employees hold it. */
  list(): Promise<Result<McpServerRow[]>>
  add(input: McpServerInput): Promise<Result<McpServerRow>>
  /** Leaving `secret` out keeps whatever the keychain holds; `null` forgets it. */
  update(id: string, patch: Partial<McpServerInput>): Promise<Result<McpServerRow>>
  /** What removing it would take with it, for the confirmation that asks first. */
  impact(id: string): Promise<Result<McpServerImpact>>
  /** Removes it and takes the grant off every Employee and role that held it. */
  remove(id: string): Promise<Result<null>>
  /**
   * Reads that Provider's own config and lists the MCP servers in it (T235). Names only:
   * the values stay in the main process, and the file is never written.
   */
  importScan(provider: Provider): Promise<Result<McpImportPreview>>
  /**
   * Adds the ticked servers of the scan just read. Their values go from the main process straight
   * to the OS secret store — the renderer never had one to send back.
   */
  importServers(provider: Provider, names: string[]): Promise<Result<McpServerRow[]>>
  /**
   * Every MCP server already configured in the tools on this machine, grouped by the tool it was
   * read from (T242). Names only, and those files are only ever read.
   */
  found(): Promise<Result<McpFoundGroup[]>>
  /**
   * Adds one server of the scan just read. Its values go from the main process straight to the OS
   * secret store — the renderer never had one to send back.
   */
  addFound(source: McpSource, name: string): Promise<Result<McpServerRow>>
  /**
   * Adds a preset the boss has filled in (T242). `values` holds what they typed, the secrets
   * among them: they go straight to the OS store, and nothing ever reads one back.
   */
  addPreset(presetId: string, name: string, values: Record<string, string>): Promise<Result<McpServerRow>>
  /** Fires after the catalogue changes, and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/**
 * The Company's catalogue of skill folders (T137). Adding, editing and removing one is the boss's:
 * a skill is instructions, and instructions steer an Employee, so no MCP tool reaches this.
 * Exposed as `window.tinyCorp.skills`.
 */
export interface SkillsApi {
  /** Every skill, in catalogue order, with whether its folder is still there and who holds it. */
  list(): Promise<Result<SkillRow[]>>
  add(input: SkillInput): Promise<Result<SkillRow>>
  update(id: string, patch: Partial<SkillInput>): Promise<Result<SkillRow>>
  /** What removing it would take with it, for the confirmation that asks first. */
  impact(id: string): Promise<Result<SkillImpact>>
  /** Removes it from the catalogue and takes the grant off everyone. The folder is left alone. */
  remove(id: string): Promise<Result<null>>
  /** Opens the folder picker and returns the folder chosen, or null when it was cancelled. */
  pickFolder(): Promise<string | null>
  /**
   * Every skill folder already on this machine, grouped by the place it was read from (T253).
   * Folders only: nothing in one is opened but the first few KB of its `SKILL.md` front matter,
   * and no agent's own folder is ever written.
   */
  found(): Promise<Result<SkillFoundGroup[]>>
  /**
   * Adds one folder of the scan just read, under its front-matter name. Nothing is copied and
   * nothing is granted: who gets it is still the role's, the way a picked folder's is.
   */
  addFound(path: string): Promise<Result<SkillRow>>
  /**
   * Every skill in the catalogue with the one line its `SKILL.md` front matter says it does, for
   * the composer's `/` palette (T264). Only the head of each `SKILL.md` is read, as the scan reads it.
   */
  described(): Promise<Result<SkillDescribed[]>>
  /** Fires after the catalogue changes, and on Company switch. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}
