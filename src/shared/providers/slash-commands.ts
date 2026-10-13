/**
 * The composer's slash commands (decision 37): `/dm`, `/ticket`, `/approve`, `/reject`, `/hire`,
 * `/pause`, `/resume` and `/goal`. Each one stands for an action the app already has; nothing here
 * reaches the engine, it only reads what the boss typed. `slash-run.ts` in the renderer dispatches.
 */
import { BOSS, CHANNEL_MENTION, dmMembers, type Mentionable, parseMentions } from '../domain/chat'

export const SLASH_NAMES = ['dm', 'ticket', 'approve', 'reject', 'hire', 'pause', 'resume', 'goal'] as const
export type SlashName = (typeof SLASH_NAMES)[number]

/** What the argument of a command completes to, when the Company knows the answers. */
export type SlashCompletion = 'employee' | 'role'

export interface SlashSpec {
  name: SlashName
  /** What follows the name in the palette, e.g. `<employee>`; empty when the command takes nothing. */
  argument: string
  /** The one line under the name in the palette. */
  summary: string
  /** Set when the argument completes to something the Company knows. */
  completes?: SlashCompletion
}

/** The palette, in the order it is drawn. */
export const SLASH_COMMANDS: SlashSpec[] = [
  {
    name: 'dm',
    argument: '<employee>',
    summary: 'Open a direct message, and send it what follows',
    completes: 'employee',
  },
  { name: 'ticket', argument: '<title>', summary: 'Add a ticket to Todo, in this epic when the channel is one' },
  { name: 'approve', argument: '', summary: 'Approve the request this thread is about' },
  { name: 'reject', argument: '<why>', summary: 'Send the request this thread is about back' },
  { name: 'hire', argument: '<role>', summary: 'Open the hire flow on a role of the catalog', completes: 'role' },
  { name: 'pause', argument: '', summary: 'Stop every Session until you resume' },
  { name: 'resume', argument: '', summary: 'Start the paused Sessions again' },
  { name: 'goal', argument: '<text>', summary: 'Send a goal to whoever holds intake' },
]

const BY_NAME = new Map<string, SlashSpec>(SLASH_COMMANDS.map((c) => [c.name, c]))

/**
 * A first token that is a command attempt: a `/` and letters, then whitespace or the end. A path
 * (`/Users/yuri/notes.md`) is not one, so it posts as the ordinary message it is.
 */
const ATTEMPT = /^\/([A-Za-z][A-Za-z-]*)(?=\s|$)/

/** The name the boss typed as the first token, lower-cased, or null when the text is not a command. */
export function slashAttempt(text: string): string | null {
  const match = ATTEMPT.exec(text)
  return match ? match[1]!.toLowerCase() : null
}

export interface SlashHit {
  /** Where the token being completed starts. */
  start: number
  query: string
  /** The command whose argument is being typed, or null while the name itself is. */
  command: SlashSpec | null
}

/** The `/…` being typed just before `caret`, or null when the caret is not in one. */
export function slashAt(text: string, caret: number): SlashHit | null {
  if (!text.startsWith('/')) return null
  const space = text.indexOf(' ')
  const nameEnd = space === -1 ? text.length : space
  if (caret >= 1 && caret <= nameEnd) return { start: 0, query: text.slice(1, caret), command: null }
  const command = BY_NAME.get(text.slice(1, nameEnd).toLowerCase())
  if (!command?.completes) return null
  const argument = nameEnd + 1
  return caret < argument ? null : { start: argument, query: text.slice(argument, caret), command }
}

/**
 * What the boss typed after `/` matches, in both of the palette's groups (T264): names that start
 * with it first, then a name that holds it or a line with a word that starts with it — `/release`
 * finds the runbook whose line says "How a release goes out". A name typed in full is still the
 * first row, so Enter on `/pause` runs it as it always has.
 */
function matching<T>(rows: readonly T[], query: string, name: (row: T) => string, line: (row: T) => string): T[] {
  const q = query.toLowerCase()
  const starts = rows.filter((row) => name(row).startsWith(q))
  const says = (row: T) =>
    name(row).includes(q) ||
    line(row)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .some((word) => word.startsWith(q))
  return [...starts, ...rows.filter((row) => !starts.includes(row) && says(row))]
}

/** The commands `query` matches, by name and by what each one does. */
export function slashSuggestions(query: string): SlashSpec[] {
  return matching(
    SLASH_COMMANDS,
    query,
    (c) => c.name,
    (c) => c.summary,
  )
}

/** One skill an Employee holds, as the palette lists it (T264). */
export interface SlashSkill {
  /** The name the agent sees it under: what follows the `/`. */
  name: string
  /** The one line its `SKILL.md` front matter says it does. */
  description: string
  /** The folder is gone, so the row says so rather than what it does. */
  missing: boolean
}

/** Whose skills the palette lists, and which. */
export interface SkillGroup {
  /** The Employee's name, as the group's label spells it: `SKILLS · ORION`. */
  owner: string
  skills: SlashSkill[]
}

/**
 * Whose skills a draft can invoke (T264): the Employee a DM is with, or, anywhere else, the one
 * Employee the draft @mentions. Null for a DM with nobody on staff, for a draft that mentions
 * nobody or more than one, and for `@channel` — a skill runs for one person.
 */
export function skillHolder(channelId: string, text: string, people: Mentionable[]): string | null {
  const members = dmMembers(channelId)
  const onStaff = (id: string) => id !== BOSS && people.some((p) => p.id === id)
  if (members) return members.find(onStaff) ?? null
  const { mentions, mentionsChannel } = parseMentions(text, people)
  const staff = mentions.filter(onStaff)
  return !mentionsChannel && staff.length === 1 ? staff[0]! : null
}

/** The skills `query` matches, by name and by what each one says it does. */
export function skillSuggestions(query: string, skills: readonly SlashSkill[]): SlashSkill[] {
  return matching(
    skills,
    query,
    (s) => s.name,
    (s) => s.description,
  )
}

/**
 * Whether what the boss typed opens with one of these skills, so it is a message that invokes it
 * rather than a command (T264). A skill that shares a command's name is the skill.
 */
export function invokesSkill(text: string, group: SkillGroup | null): boolean {
  const name = slashAttempt(text)
  return name !== null && group !== null && group.skills.some((s) => s.name === name)
}

/** Who the boss can be talking to and hiring, for the argument half of the palette. */
export interface SlashOptions {
  /** Everyone on staff. `@channel` is not one of them: a DM goes to a person. */
  people: Mentionable[]
  /** The hiring catalog. */
  roles: { id: string; name: string }[]
}

export interface SlashArgument {
  /** What goes into the box. */
  value: string
  /** What the palette row reads. */
  label: string
}

/** What `query` could mean for a command's argument: an Employee for `/dm`, a role for `/hire`. */
export function slashArguments(command: SlashSpec, query: string, options: SlashOptions): SlashArgument[] {
  const q = query.toLowerCase()
  const names =
    command.completes === 'employee'
      ? options.people.filter((p) => p.id !== CHANNEL_MENTION).map((p) => p.name)
      : command.completes === 'role'
        ? options.roles.map((r) => r.name)
        : []
  return names.filter((name) => name.toLowerCase().startsWith(q)).map((name) => ({ value: name, label: name }))
}

/**
 * `text` with the token at `start…caret` replaced by `inserted`, and where the caret goes next.
 * `inserted` ends in the space that starts the next word, so a space already there is not doubled.
 */
export function completeSlash(
  text: string,
  start: number,
  caret: number,
  inserted: string,
): { text: string; caret: number } {
  const rest = text.slice(caret)
  const tail = inserted.endsWith(' ') && rest.startsWith(' ') ? rest.slice(1) : rest
  return { text: text.slice(0, start) + inserted + tail, caret: start + inserted.length }
}

/** One command, read and resolved against the Company. `slash-run.ts` carries each one out. */
export type SlashCommand =
  | { kind: 'dm'; employeeId: string; text: string }
  | { kind: 'ticket'; title: string }
  | { kind: 'approve' }
  | { kind: 'reject'; reason: string }
  | { kind: 'hire'; roleId: string }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'goal'; text: string }

export type SlashParse = { ok: true; command: SlashCommand } | { ok: false; hint: string }

/** The hint an unknown command shows; the boss is told where the list is. */
export function unknownHint(name: string): string {
  return `/${name} is not a command. Type / to see them all.`
}

function missing(spec: SlashSpec): SlashParse {
  return { ok: false, hint: `/${spec.name} needs one more word: /${spec.name} ${spec.argument}` }
}

/**
 * What the boss typed, or why it cannot run. Only a `slashAttempt` gets here: anything else is an
 * ordinary message and is posted as written.
 */
export function parseSlash(text: string, options: SlashOptions): SlashParse {
  const name = slashAttempt(text)
  if (name === null) return { ok: false, hint: 'Type a command after the /.' }
  const spec = BY_NAME.get(name)
  if (!spec) return { ok: false, hint: unknownHint(name) }
  const rest = text.slice(name.length + 1).trim()
  switch (spec.name) {
    case 'pause':
      return { ok: true, command: { kind: 'pause' } }
    case 'resume':
      return { ok: true, command: { kind: 'resume' } }
    case 'approve':
      return { ok: true, command: { kind: 'approve' } }
    case 'reject':
      return rest ? { ok: true, command: { kind: 'reject', reason: rest } } : missing(spec)
    case 'ticket':
      return rest ? { ok: true, command: { kind: 'ticket', title: rest } } : missing(spec)
    case 'goal':
      return rest ? { ok: true, command: { kind: 'goal', text: rest } } : missing(spec)
    case 'dm':
      return parseDm(rest, spec, options)
    case 'hire':
      return parseHire(rest, spec, options)
  }
}

/** `/dm <employee> [message]`: the longest name the rest starts with, and what is left is the message. */
function parseDm(rest: string, spec: SlashSpec, options: SlashOptions): SlashParse {
  if (!rest) return missing(spec)
  const lower = rest.toLowerCase()
  const hit = [...options.people]
    .filter((p) => p.name && p.id !== CHANNEL_MENTION)
    .sort((a, b) => b.name.length - a.name.length)
    .find((p) => lower.startsWith(p.name.toLowerCase()) && !/^[\p{L}\p{N}_]/u.test(lower.slice(p.name.length)))
  if (!hit) return { ok: false, hint: `Nobody here is called “${rest.split(/\s+/)[0]}”.` }
  return { ok: true, command: { kind: 'dm', employeeId: hit.id, text: rest.slice(hit.name.length).trim() } }
}

/** `/hire <role>`: the catalog role named in full, else the only one that name begins. */
function parseHire(rest: string, spec: SlashSpec, options: SlashOptions): SlashParse {
  if (!rest) return missing(spec)
  const q = rest.toLowerCase()
  const exact = options.roles.find((r) => r.name.toLowerCase() === q)
  if (exact) return { ok: true, command: { kind: 'hire', roleId: exact.id } }
  const starts = options.roles.filter((r) => r.name.toLowerCase().startsWith(q))
  if (starts.length === 1) return { ok: true, command: { kind: 'hire', roleId: starts[0]!.id } }
  if (starts.length === 0) return { ok: false, hint: `No role is called “${rest}”.` }
  return { ok: false, hint: `“${rest}” could be ${starts.map((r) => r.name).join(', ')}. Name one.` }
}
