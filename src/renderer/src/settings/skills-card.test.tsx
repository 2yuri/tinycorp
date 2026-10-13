import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  MISSING_FOLDER_LINE,
  nameFromPath,
  type SkillRow,
  skillHoldersLine,
  skillProblems,
  skillRemovalLine,
  skillsMeta,
} from '../../../shared/catalogue/skills'

/**
 * Company settings → Integrations, the Skills card (T137, frame `uApL8`): the row, the add form
 * and the sentences both of them and the engine share.
 *
 * The form is what the boss reads before handing an Employee something that steers it, so what it
 * says about trust is under test here, not only that it renders.
 */

const checklist: SkillRow = {
  id: 'sk1',
  name: 'review-checklist',
  path: '/Users/boss/skills/review-checklist',
  missing: false,
  employees: 4,
}

const moved: SkillRow = { ...checklist, id: 'sk2', name: 'pen-handoff', path: '/Users/boss/gone', missing: true }

let SkillForm: typeof import('./IntegrationsTab').SkillForm

beforeAll(async () => {
  ;(globalThis as { window?: unknown }).window = { tinyCorp: { mcp: {}, skills: {} } }
  ;({ SkillForm } = await import('./IntegrationsTab'))
})

function form(skill: SkillRow | null, skills: SkillRow[] = []) {
  return renderToStaticMarkup(
    <SkillForm skill={skill} skills={skills} onSave={() => {}} onCancel={() => {}} pickFolder={async () => null} />,
  )
}

describe('The Add skill folder form', () => {
  it('says where the folder came from matters, and that nothing in it is run', () => {
    const html = form(null)

    expect(html).toContain('A skill steers whoever holds it')
    expect(html).toMatch(/the same trust as a repo this Company works in/i)
    expect(html).toMatch(/never parses, validates or runs anything in it/i)
  })

  it('says the folder stays where it is, once there is one to say it about', () => {
    expect(form(checklist)).toMatch(/links to it, never copies it/i)
  })

  it('opens on the skill being edited, folder and name', () => {
    const html = form(checklist)

    expect(html).toContain('Edit review-checklist')
    expect(html).toContain('/Users/boss/skills/review-checklist')
  })
})

describe('The skill a form is about to save', () => {
  it('takes its name from the folder the boss picked', () => {
    expect(nameFromPath('/Users/boss/skills/review-checklist')).toBe('review-checklist')
    expect(nameFromPath('/Users/boss/skills/Deploy Runbook/')).toBe('deploy-runbook')
  })

  it('refuses a name the Company already has, in the same words as the engine', () => {
    const clash = { name: 'review-checklist', path: '/Users/boss/other' }

    expect(skillProblems(clash, [checklist.name]).name).toMatch(/already has a skill named review-checklist/i)
    expect(skillProblems(clash, []).name).toBeUndefined()
  })

  it('refuses no folder, and a folder that is not an absolute path', () => {
    expect(skillProblems({ name: 'a', path: '' }).path).toMatch(/choose the folder/i)
    expect(skillProblems({ name: 'a', path: 'skills/rel' }).path).toMatch(/absolute path/i)
  })
})

describe('What a row says', () => {
  it('counts who gets it', () => {
    expect(skillHoldersLine(0)).toBe('No employees')
    expect(skillHoldersLine(1)).toBe('1 employee')
    expect(skillHoldersLine(4)).toBe('4 employees')
  })

  it('says a folder is missing rather than pretending the grant works', () => {
    expect(moved.missing && MISSING_FOLDER_LINE).toBe('Folder is missing')
  })

  it('says what removing it takes with it, and that the folder itself stays', () => {
    const line = skillRemovalLine({ name: 'review-checklist', employees: 4, roles: 1 })

    expect(line).toContain('4 Employees')
    expect(line).toContain('1 role')
    expect(line).toMatch(/folder on your Mac is left where it is/i)
  })
})

describe('What the Employee’s drawer says', () => {
  it('counts the skills it holds', () => {
    expect(skillsMeta([{ name: 'a', missing: false }], 'Claude Code', true)).toBe('1 skill')
    expect(
      skillsMeta(
        [
          { name: 'a', missing: false },
          { name: 'b', missing: false },
        ],
        'Claude Code',
        true,
      ),
    ).toBe('2 skills')
  })

  it('names the folders that are not there any more', () => {
    expect(
      skillsMeta(
        [
          { name: 'a', missing: false },
          { name: 'b', missing: true },
        ],
        'Claude Code',
        true,
      ),
    ).toBe('2 skills · 1 missing')
  })

  it('says `Codex — no skills` rather than pretending the grant did something', () => {
    expect(skillsMeta([{ name: 'a', missing: false }], 'Codex', false)).toBe('Codex — no skills')
  })

  it('says nothing at all about an Employee that holds none', () => {
    expect(skillsMeta([], 'Claude Code', true)).toBeNull()
    expect(skillsMeta([], 'Codex', false)).toBeNull()
  })
})
