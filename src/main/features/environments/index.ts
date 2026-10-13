/**
 * The Company's Environments: its secrets, and the commands that are allowed to use one (T176).
 *
 * The feature's front door. Names and toggles are rows in the Company's database, values are in the
 * OS secret store, and nothing here ever hands a value to an Employee — only the names it ran with.
 */

export type { EnvRunRequest } from './environment-runs'
export { ENVIRONMENTS_MIGRATION } from './environments'
export type { EnvironmentsFacade } from './facade'
export { registerEnvironmentsIpc } from './ipc'
export { registerEnvTools } from './tools'
export { type EnvironmentsOptions, register as registerEnvironments } from './wire'
