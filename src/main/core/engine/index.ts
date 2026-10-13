/**
 * The engine: the one holder of domain state, and the only place that knows every feature.
 *
 * This is its front door. `company-engine.ts` is the composition root — it registers each feature
 * against the context they share and hands each one its neighbours; `facade.ts` is what the engine
 * is to a screen and `options.ts` what the boss's app hands it, both composed from what each
 * feature declares; `mcp-caller.ts` is the other process's way in; `migrations.ts` is the order
 * their tables are made in; `company-mcp-server.ts` is the same state served to Employees over MCP.
 *
 * It is a folder of its own because it names every feature, and a feature may name `core`. Keeping
 * the two front doors apart is what makes that safe: nothing a feature imports leads back here.
 */

export { type CompanyEngine, createCompanyEngine } from './company-engine'
export { startCompanyMcpServer } from './company-mcp-server'
export type { McpCaller } from './mcp-caller'
