import type { SubagentInfo } from '../../../shared/subagents'
import type { SubagentSignal } from '../../providers'

/**
 * How many finished subagents a Session keeps on its strip. The running ones are always kept; a
 * long day would otherwise grow a strip of every subagent the Employee ever ran.
 */
export const FINISHED_KEPT = 5

/**
 * One Session's subagents (T162), built from what its Provider's hooks said and nothing else. It
 * lives and dies with the running Session: a parent that is killed takes every subagent with it,
 * so nothing it started can show as running after it is gone.
 */
export interface SubagentModel {
  /** Applies a signal. True when what the strip shows changed. */
  apply(signal: SubagentSignal, at: Date): boolean
  list(): SubagentInfo[]
}

/** What the parent asked for. */
interface Call {
  id: string
  type: string | null
  name: string
  task: string
  calledAt: string
  agentId: string | null
  /** It came back with an answer rather than a launch: the agent is done whatever else was heard. */
  answered: string | null
}

/** What then ran. */
interface Agent {
  id: string
  type: string | null
  startedAt: string
  stoppedAt: string | null
  now: string | null
  files: Set<string>
}

export function createSubagentModel(): SubagentModel {
  const calls = new Map<string, Call>()
  const agents = new Map<string, Agent>()

  const callOf = (agentId: string) => [...calls.values()].find((call) => call.agentId === agentId)

  function agent(agentId: string, type: string | null, at: string): Agent {
    let found = agents.get(agentId)
    if (!found) {
      found = { id: agentId, type, startedAt: at, stoppedAt: null, now: null, files: new Set() }
      agents.set(agentId, found)
    }
    return found
  }

  /** Pairs an agent with the oldest call of its type still waiting for one, or any waiting call. */
  function pair(found: Agent): void {
    if (callOf(found.id)) return
    const waiting = [...calls.values()].filter((call) => call.agentId === null && call.answered === null)
    const call = waiting.find((c) => c.type === found.type) ?? waiting[0]
    if (call) call.agentId = found.id
  }

  function info(call: Call | null, found: Agent | null): SubagentInfo {
    const endedAt = call?.answered ?? found?.stoppedAt ?? null
    return {
      id: call?.id ?? found!.id,
      name: call?.name ?? found?.type ?? 'subagent',
      task: call?.task ?? found?.type ?? 'subagent',
      state: endedAt !== null ? 'done' : found ? 'running' : 'started',
      startedAt: call?.calledAt ?? found!.startedAt,
      endedAt,
      now: found?.now ?? null,
      filesChanged: found?.files.size ?? 0,
    }
  }

  function list(): SubagentInfo[] {
    const paired = new Set<string>()
    const rows: SubagentInfo[] = []
    for (const call of calls.values()) {
      const found = call.agentId ? (agents.get(call.agentId) ?? null) : null
      if (call.agentId) paired.add(call.agentId)
      rows.push(info(call, found))
    }
    // An agent no call was heard for — the app came up mid-turn, say — still shows, under its type.
    for (const found of agents.values()) if (!paired.has(found.id)) rows.push(info(null, found))
    return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  /** Forgets the oldest finished subagents beyond {@link FINISHED_KEPT}. */
  function trim(): void {
    const finished = list().filter((row) => row.state === 'done')
    for (const row of finished.slice(0, Math.max(0, finished.length - FINISHED_KEPT))) {
      const call = calls.get(row.id)
      if (call) {
        calls.delete(call.id)
        if (call.agentId) agents.delete(call.agentId)
      } else agents.delete(row.id)
    }
  }

  return {
    apply(signal, date) {
      const before = JSON.stringify(list())
      const at = date.toISOString()
      switch (signal.kind) {
        case 'called':
          if (!calls.has(signal.callId)) {
            calls.set(signal.callId, {
              id: signal.callId,
              type: signal.type,
              name: signal.name,
              task: signal.task,
              calledAt: at,
              agentId: null,
              answered: null,
            })
          }
          break
        case 'started':
          pair(agent(signal.agentId, signal.type, at))
          break
        case 'tool': {
          const found = agent(signal.agentId, null, at)
          pair(found)
          if (found.stoppedAt === null) found.now = signal.now
          if (signal.file) found.files.add(signal.file)
          break
        }
        case 'returned': {
          const call = calls.get(signal.callId)
          if (!call) break
          if (signal.agentId && call.agentId !== signal.agentId) {
            // The product named the agent: that pairing is certain, and a guess is undone.
            const other = callOf(signal.agentId)
            if (other) other.agentId = call.agentId
            call.agentId = signal.agentId
            agent(signal.agentId, call.type, at)
          }
          if (!signal.background) call.answered = at
          break
        }
        case 'stopped': {
          const found = agent(signal.agentId, null, at)
          pair(found)
          found.stoppedAt ??= at
          break
        }
        case 'settled':
          for (const call of calls.values()) {
            if (call.agentId === null && call.answered === null) call.answered = at
          }
          if (signal.running) {
            for (const found of agents.values()) {
              if (!signal.running.includes(found.id)) found.stoppedAt ??= at
            }
          }
          break
      }
      trim()
      return JSON.stringify(list()) !== before
    },

    list,
  }
}
