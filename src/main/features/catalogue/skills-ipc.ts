import { join } from 'node:path'
import type { SkillFoundGroup } from '../../../shared/catalogue/skill-sources'
import type { SkillDescribed, SkillInput, SkillRow } from '../../../shared/catalogue/skills'
import { skillChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import { createSkillSources, frontMatter, type SkillSources } from './skill-sources'
import type { SkillsFacade } from './wire'

export interface SkillsIpcOptions {
  ipc: IpcHandlerRegistry
  engine: SkillsFacade
  /** Opens the folder picker. Returns the folder chosen, or null when the boss cancelled. */
  pickFolder(): Promise<string | null>
  broadcastChanged(): void
  /**
   * What the tab reads when it opens (T253). Injected so a test names its own fixture home rather
   * than the boss's, and so the reading of somebody else's folders stays one module with one
   * reason to be opened.
   */
  sources?: SkillSources
  /** The checkouts this Company works in, whose own skill folders are read too. */
  repos?: () => readonly string[]
  /** The home folders inside WSL to read as well, when the team runs there (T249). */
  wslHomes?: () => readonly string[]
}

/**
 * The Company's skill catalogue, for Company settings → Integrations (T137).
 *
 * Only the renderer reaches it: a skill is a folder of instructions, and instructions steer an
 * Employee, so handing one out is the boss's the way granting an MCP server is (T136). Nothing
 * here opens, parses or runs anything in a skill folder — the catalogue holds a name and a path.
 */
export function registerSkillsIpc({
  ipc,
  engine,
  pickFolder,
  broadcastChanged,
  repos = () => [],
  wslHomes = () => [],
  sources = createSkillSources({ repos, wslHomes }),
}: SkillsIpcOptions): void {
  engine.skills.onChange(broadcastChanged)

  ipc.handle(skillChannels.list, () => attempt(() => engine.skills.list()))
  ipc.handle(skillChannels.add, (_event, input) => attempt(() => engine.skills.create(skillInput(input, true))))
  ipc.handle(skillChannels.update, (_event, id, patch) =>
    attempt(() => engine.skills.update(requireId(id), skillInput(patch, false))),
  )
  ipc.handle(skillChannels.impact, (_event, id) => attempt(() => engine.skills.impact(requireId(id))))
  ipc.handle(skillChannels.remove, (_event, id) =>
    attempt(() => {
      engine.skills.remove(requireId(id))
      return null
    }),
  )
  ipc.handle(skillChannels.pickFolder, () => pickFolder())

  // What the agents on this machine already have, by folder (T253). Nothing in one is opened but
  // the head of its `SKILL.md`, and none of those folders is ever written.
  ipc.handle(skillChannels.found, () => attempt((): SkillFoundGroup[] => sources.scan(engine.skills.list())))
  ipc.handle(skillChannels.described, () => attempt(() => describeSkills(engine.skills.list())))
  ipc.handle(skillChannels.addFound, (_event, path) =>
    attempt((): SkillRow => {
      const input = sources.take(requireText(path, 'folder'))
      if (!input) throw new Error(`${String(path)} is not one of the folders just found`)
      return engine.skills.create(input)
    }),
  )
}

/**
 * The catalogue with each skill's description, read from the head of its `SKILL.md` the way the
 * machine scan reads it (T264). A folder that is gone, or a file with no front matter, says nothing.
 */
export function describeSkills(rows: readonly SkillRow[]): SkillDescribed[] {
  return rows.map(({ id, name, path, missing }) => ({
    id,
    name,
    missing,
    description: missing ? '' : (frontMatter(join(path, 'SKILL.md'))?.description ?? ''),
  }))
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Missing the ${what}`)
  return value
}

function requireId(id: unknown): string {
  if (typeof id !== 'string' || id === '') throw new Error('Missing skill id')
  return id
}

/** The fields the renderer may set: a name and a folder, both text. */
function skillInput(input: unknown, whole: boolean): SkillInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected an object')
  const { name, path } = input as Record<string, unknown>
  const fields = { name: optionalText(name, 'name'), path: optionalText(path, 'folder') }
  const given = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  if (whole && (given['name'] === undefined || given['path'] === undefined)) {
    throw new Error('A skill needs a name and a folder')
  }
  return given as unknown as SkillInput
}

function optionalText(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`A skill's ${what} must be text`)
  return value
}
