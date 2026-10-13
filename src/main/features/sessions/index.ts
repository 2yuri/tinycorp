/**
 * A Session: starting it, what it is told, the terminal it lives in, what wakes it, and the Sessions
 * it starts of its own.
 *
 * The feature's front door. Everything about one Employee's long-lived coding-agent process is
 * here — the spawn, the instructions it opens with, the seats it takes from the Company's cap, the
 * pause and the restore that bring it back, the wakes a ticket or a thread sends it, and the
 * sub-sessions it spawns (T163). The two add-ons are here too — Lean builder (T194) and Caveman
 * (T261): the only thing either setting changes is what a Session is told at spawn. What a Session *is* to the screens is in
 * `src/shared/session.ts`.
 */

export { BUILD_STYLE_MIGRATION } from './build-style'
export { registerBuildStyleIpc } from './build-style-ipc'
export { CAPACITY_MIGRATION, type Capacity, type CapacityService } from './capacity'
export { registerCapacityIpc } from './capacity-ipc'
export { CAVEMAN_MIGRATION } from './caveman'
export { registerCavemanIpc } from './caveman-ipc'
export type {
  BuildStyleFacade,
  CapacityFacade,
  CavemanFacade,
  SessionsFacade,
  SpawnSettingsFacade,
  TerminalsFacade,
} from './facade'
export { GENERAL_WAKES_MIGRATION, generalPrompt, isGeneralPost } from './general-wakes'
export { handoffPrompt, type RoutingHandoff } from './handoff-prompt'
export { registerSessionIpc } from './ipc'
export { PAUSE_MIGRATION } from './pause'
export { RESTORE_MIGRATION } from './restore'
export {
  type BudgetSignal,
  SESSIONS_MIGRATION,
  type SessionActivity,
  type Sessions,
} from './sessions'
export { registerSpawnSettingsIpc } from './spawn-settings-ipc'
export type { SubSessionRequest } from './sub-sessions'
export { registerTerminalIpc } from './terminal-ipc'
export { quietedIn, repliedTo, threadContext, threadPrompt, withoutThreadWake } from './thread-wakes'
export {
  type ActingBoard,
  TICKET_WAKES_MIGRATION,
  type TicketWakes,
  withoutWakes,
} from './ticket-wakes'
export { registerSessionTools, registerSubSessionTools } from './tools'
export { register as registerSessions, type SessionsOptions } from './wire'
