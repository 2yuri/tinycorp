import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  opensCollapsed,
  SKILL_SOURCE_LABEL,
  SKILLS_FOUND_EMPTY,
  SKILLS_FOUND_PLUGINS_TOGGLE,
  SKILLS_FOUND_PREVIEW,
  SKILLS_FOUND_SUB,
  type SkillFound,
  type SkillFoundGroup,
  showAllLine,
  skillFoundMatches,
  skillsFoundCountLine,
  skillsFoundTotal,
} from '../../../shared/catalogue/skill-sources'
import type { SkillRow } from '../../../shared/catalogue/skills'
import type { Result } from '../../../shared/domain/result'
import { tildePath } from '../paths'
import { Alert, Badge, Button, cx, SettingsCard } from '../ui'
import { LIST, NONE, ROW_BASE, ROW_EDGE, ROW_HEAD, ROW_NAME, ROW_TEXT } from './mcp-parts'

/*
 * Company settings › Integrations › Skills found on this machine (T253, frame `LBKv1`).
 *
 * T137 gave the Company one folder at a time, through the picker. This is the rest of them: when
 * the tab opens, every place an agent on this machine reads skills from is listed, and each folder
 * is one click away. The folders are read in the main process and never written, nothing in one is
 * opened but the head of its `SKILL.md`, and adding one grants it to nobody — that is still the
 * role's, exactly as it is for a folder the boss picks by hand.
 */

/** The label over one place's rows: whose folder it is, where, and how many it really holds. */
const GROUP = 'flex flex-col gap-6'
const GROUP_LABEL = 'flex items-center gap-8'
const GROUP_SOURCE = 'text-10-5/13 font-bold uppercase tracking-[0.5px] text-muted-foreground'
const GROUP_PATH =
  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-code text-10-5/13 text-muted-foreground opacity-80'
const GROUP_COUNT = 'ml-auto shrink-0 text-10-5/13 text-muted-foreground'

const GROUPS = 'flex flex-col gap-12'

/** A skill row is taller than an MCP one — a name line and a sentence — and holds no path. */
const SKILL_ROW_TEXT = 'flex min-w-0 flex-[1_1_auto] flex-col gap-4'
const SKILL_SAYS = 'overflow-hidden text-ellipsis whitespace-nowrap text-11-5/15 text-muted-foreground'

/** Why a folder cannot be added at all, said on the row in place of the button. */
const SKILL_PROBLEM = 'shrink-0 text-right text-11/14 text-muted-foreground'

/** A row already in the catalogue: a quiet pill in place of the button, so the row never moves. */
const ADDED =
  'flex shrink-0 items-center gap-5 rounded-full bg-secondary px-9 py-3 text-11/13 font-semibold text-muted-foreground'

/** The rest of a long group, on its own line under the three the card shows. */
const MORE =
  'flex cursor-pointer items-center gap-6 self-start border-0 bg-transparent p-0 text-11-5/14 text-muted-foreground hover:text-foreground'

const api = () => window.tinyCorp

/** The scan and the add, at module scope so the effect's dependency does not change per render. */
const scanMachine = () => api().skills.found()
const addFoundSkill = (path: string) => api().skills.addFound(path)

export function SkillsFoundCard({
  query,
  onCount,
  found = scanMachine,
  addFound = addFoundSkill,
}: {
  /** The tab's search. A group with nothing left in it is not drawn. */
  query: string
  /** How many folders the scan found, for the tab's count line. */
  onCount(total: number): void
  /** The scan and the add. Injected in the tests and the capture, which have no main process. */
  found?(): Promise<Result<SkillFoundGroup[]>>
  addFound?(path: string): Promise<Result<SkillRow>>
}) {
  const [groups, setGroups] = useState<SkillFoundGroup[] | null>(null)
  const [opened, setOpened] = useState<readonly string[]>([])
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
  const total = skillsFoundTotal(groups ?? [])
  useEffect(() => {
    onCount(total)
  }, [onCount, total])

  async function add(path: string) {
    const result = await addFound(path)
    if (!result.ok) return setError(result.error)
    setError(null)
    // The catalogue has it now, so the row says so without reading every folder again.
    setGroups(
      (held) =>
        held?.map((group) => ({
          ...group,
          skills: group.skills.map((skill) => (skill.path === path ? { ...skill, added: true } : skill)),
        })) ?? null,
    )
  }

  const shown = (groups ?? [])
    .map((group) => ({ ...group, skills: group.skills.filter((skill) => skillFoundMatches(skill, query)) }))
    .filter((group) => group.skills.length > 0)

  return (
    <SettingsCard title="Skills found on this machine" sub={SKILLS_FOUND_SUB}>
      {error && <Alert variant="error" title={error} onClose={() => setError(null)} />}
      {groups !== null && total === 0 && <p className={NONE}>{SKILLS_FOUND_EMPTY}</p>}
      {shown.length > 0 && (
        <div className={GROUPS}>
          {shown.map((group) => (
            <FoundGroup
              key={`${group.source}\u0000${group.path}`}
              group={group}
              // A search is the boss asking for a folder by name: what it matched is shown, in
              // whatever group it is in, rather than hidden behind the group's own fold.
              open={opened.includes(group.path) || query.trim() !== ''}
              onOpen={() => setOpened((held) => [...held, group.path])}
              onAdd={(path) => void add(path)}
            />
          ))}
        </div>
      )}
    </SettingsCard>
  )
}

/** One place: its label, the three rows the card shows, and the way to the rest of them. */
function FoundGroup({
  group,
  open,
  onOpen,
  onAdd,
}: {
  group: SkillFoundGroup
  open: boolean
  onOpen(): void
  onAdd(path: string): void
}) {
  // The plugins' group opens shut, because it is the long one nobody went looking for.
  const preview = open ? group.skills.length : opensCollapsed(group) ? 0 : SKILLS_FOUND_PREVIEW
  const rest = group.skills.length - preview
  return (
    <div className={GROUP} data-ui="Skill source">
      <div className={GROUP_LABEL}>
        <span className={GROUP_SOURCE}>{SKILL_SOURCE_LABEL[group.source]}</span>
        <span className={GROUP_PATH} title={group.path}>
          {tildePath(group.path)}
        </span>
        <span className={GROUP_COUNT}>{skillsFoundCountLine(group)}</span>
      </div>
      {preview > 0 && (
        <div className={LIST}>
          {group.skills.slice(0, preview).map((skill) => (
            <FoundRow key={skill.path} skill={skill} onAdd={() => onAdd(skill.path)} />
          ))}
        </div>
      )}
      {rest > 0 && (
        <button type="button" className={MORE} onClick={onOpen}>
          <ChevronDown size={13} aria-hidden />
          {preview === 0 ? SKILLS_FOUND_PLUGINS_TOGGLE : showAllLine(group.skills.length)}
        </button>
      )}
    </div>
  )
}

/** One found folder: its name, who else reads it, what it says it does, and one button. */
function FoundRow({ skill, onAdd }: { skill: SkillFound; onAdd(): void }) {
  return (
    <div className={cx(ROW_BASE, ROW_EDGE)} data-ui="Found skill">
      <div className={cx(ROW_TEXT, SKILL_ROW_TEXT)}>
        <div className={ROW_HEAD}>
          <span className={ROW_NAME}>{skill.name}</span>
          {skill.seenBy.map((tool) => (
            <Badge key={tool} variant="neutral">
              {tool}
            </Badge>
          ))}
        </div>
        {skill.description && (
          <div className={SKILL_SAYS} title={skill.description}>
            {skill.description}
          </div>
        )}
      </div>
      {skill.problem && <span className={SKILL_PROBLEM}>{skill.problem}</span>}
      {skill.added ? (
        <span className={ADDED}>
          <Check size={12} aria-hidden />
          Added
        </span>
      ) : (
        skill.problem === null && (
          <Button variant="outline" size="sm" icon={Plus} aria-label={`Add ${skill.name}`} onClick={onAdd}>
            Add
          </Button>
        )
      )}
    </div>
  )
}
