/**
 * The catalogue: the Company's MCP servers and its skill folders, and who is granted them.
 *
 * Two lists the boss keeps and every Employee inherits a slice of — an MCP server is a tool an
 * Employee can call (T136), a skill folder is a folder linked into the worktrees of whoever holds
 * it (T137). They are one module because they are the same shape: a table, a grant per Employee
 * and a role, and a summary the Session's config is written from.
 *
 * This is the module's front door. The row readers, the grant parsers' storage format and the
 * copy marker stay inside, and the tests name them directly.
 */

export { registerMcpIpc } from './mcp-ipc'
export {
  cleanGrants,
  MCP_HEADERS_MIGRATION,
  MCP_SECRET_NAMES_MIGRATION,
  MCP_SERVERS_MIGRATION,
  parseGrants,
} from './mcp-servers'
export {
  cleanSkillGrants,
  folderExists,
  parseSkillGrants,
  SKILLS_MIGRATION,
} from './skills'
export { registerSkillsIpc } from './skills-ipc'
export type { McpFacade, SkillsFacade } from './wire'
export { register as registerCatalogue } from './wire'
