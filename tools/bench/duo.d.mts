/** Types for `tools/bench/duo.mjs`: two Employees, one ticket, a real DM thread (T197). */

import type { Arm } from './arms.mjs'
import type { Task } from './plan.mjs'
import type { DmTraffic, MeasuredPart } from './report.mjs'

/** One of the two Employees of a duo cell. */
export interface Role {
  role: string
  name: string
  what: string
}

export const ROLES: { lead: Role; helper: Role }
export const DUO_MAX_DELIVERIES: number
export const DUO_TASKS: readonly string[]
/** The clause a wake prompt carries, per voice — `voiceHint` in the app, word for word. */
export const VOICE_HINT: { terse: string; plain: string }

export function peerOf(role: string): Role
export function duoUnits(tasks: readonly Task[], ids?: readonly string[]): Task[]
export function rolePrompt(role: string, context: { task: Task }): string
export function wakePrompt(options: { from: string; message: { id: number; text: string }; voice: string }): string

/** The chat server one Employee is started with: this repo's `dm-mcp.mjs`, under the app's name. */
export function duoMcpConfig(options: { me: string; peer: string; dmFile: string; here?: string }): {
  mcpServers: { company: { command: string; args: string[]; env: Record<string, string> } }
}

/** The next DM nobody has been woken with, and where the cursor lands once they have. */
export function nextDelivery(
  messages: readonly { channelId: string }[],
  cursor: number,
): { message: { id: number; text: string; author: string; channelId: string }; cursor: number } | null

export function runDuoCell(options: {
  claude: string
  model: string
  arm: Arm
  settingsFile: string | null
  cwd: string
  env: NodeJS.ProcessEnv
  budgetUsd?: number | null
  dir: string
  task: Task
  sessionIds: Record<string, string>
  maxDeliveries?: number
}): Promise<{ sessionIds: string[]; parts: MeasuredPart[]; dm: DmTraffic }>
