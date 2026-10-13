import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFolder } from '../../core/testing'
import { createSkillSources, frontMatter } from './skill-sources'

/**
 * Reading the skill folders already on this machine (T253).
 *
 * The whole of this module is about somebody else's folders, so these tests are about somebody
 * else's folders too: a home on disk with the real shapes in it — a link from one agent's folder
 * into the shared one, a hidden folder, a folder with no `SKILL.md`, a front matter that will not
 * parse, a marketplace beside an installed plugin. A fake here would only ever agree with the code.
 *
 * The links are made as junctions on Windows, which needs no administrator, so the same test runs
 * on all three runners.
 */

const LINK_KIND = process.platform === 'win32' ? 'junction' : 'dir'

let home = ''
afterEach(() => {
  if (home) removeFolder(home)
  home = ''
})

/** A fixture home, and the environment that points every reader at it. */
function makeHome(): { home: string; env: NodeJS.ProcessEnv } {
  home = mkdtempSync(join(tmpdir(), 'tinycorp-skills-'))
  return { home, env: { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config') } }
}

/** A skill folder: `<at>/SKILL.md` with the front matter a real one carries. */
function writeSkill(at: string, name: string, description = `what ${name} does`): string {
  mkdirSync(at, { recursive: true })
  writeFileSync(join(at, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`)
  return at
}

function scan(env: NodeJS.ProcessEnv, taken: { name: string; path: string }[] = [], repos: string[] = []) {
  return createSkillSources({ env, platform: 'linux', repos: () => repos }).scan(taken)
}

const group = (groups: ReturnType<typeof scan>, source: string) => groups.find((entry) => entry.source === source)
const names = (groups: ReturnType<typeof scan>, source: string) =>
  (group(groups, source)?.skills ?? []).map((skill) => skill.name)

describe('skills found on this machine', () => {
  it('finds a skill in every place an agent on this machine reads them from', () => {
    const { home, env } = makeHome()
    writeSkill(join(home, '.agents/skills/shared-one'), 'shared-one')
    writeSkill(join(home, '.claude/skills/claude-one'), 'claude-one')
    writeSkill(join(home, '.codex/skills/codex-one'), 'codex-one')
    writeSkill(join(home, '.config/opencode/skills/opencode-one'), 'opencode-one')

    const groups = scan(env)

    expect(names(groups, 'shared')).toEqual(['shared-one'])
    expect(names(groups, 'claude-code')).toEqual(['claude-one'])
    expect(names(groups, 'codex')).toEqual(['codex-one'])
    expect(names(groups, 'opencode')).toEqual(['opencode-one'])
  })

  it('reads a folder linked from another agent once, where it really lives, and says who links it', () => {
    const { home, env } = makeHome()
    const real = writeSkill(join(home, '.agents/skills/ai-sdk'), 'ai-sdk')
    mkdirSync(join(home, '.claude/skills'), { recursive: true })
    symlinkSync(real, join(home, '.claude/skills/ai-sdk'), LINK_KIND)

    const groups = scan(env)

    expect(group(groups, 'shared')?.skills).toEqual([
      expect.objectContaining({ name: 'ai-sdk', seenBy: ['Claude Code'] }),
    ])
    // The one folder is one row: the place that only points at it draws no group of its own.
    expect(group(groups, 'claude-code')).toBeUndefined()
  })

  it('says how many a place really holds when the rest of its entries point elsewhere', () => {
    const { home, env } = makeHome()
    const real = writeSkill(join(home, '.agents/skills/shared-one'), 'shared-one')
    writeSkill(join(home, '.claude/skills/its-own'), 'its-own')
    symlinkSync(real, join(home, '.claude/skills/shared-one'), LINK_KIND)

    const groups = scan(env)

    expect(group(groups, 'claude-code')).toMatchObject({ elsewhere: 1 })
    expect(names(groups, 'claude-code')).toEqual(['its-own'])
  })

  it('steps over a hidden folder and a folder with no SKILL.md, and counts neither', () => {
    const { home, env } = makeHome()
    writeSkill(join(home, '.codex/skills/.system/imagegen'), 'imagegen')
    mkdirSync(join(home, '.codex/skills/empty'), { recursive: true })
    writeSkill(join(home, '.codex/skills/real-one'), 'real-one')

    expect(names(scan(env), 'codex')).toEqual(['real-one'])
  })

  it('steps over a SKILL.md whose front matter will not parse', () => {
    const { home, env } = makeHome()
    mkdirSync(join(home, '.agents/skills/no-fence'), { recursive: true })
    writeFileSync(join(home, '.agents/skills/no-fence/SKILL.md'), '# just a heading\n')
    mkdirSync(join(home, '.agents/skills/no-name'), { recursive: true })
    writeFileSync(join(home, '.agents/skills/no-name/SKILL.md'), '---\ndescription: nameless\n---\n')
    writeSkill(join(home, '.agents/skills/fine'), 'fine')

    expect(names(scan(env), 'shared')).toEqual(['fine'])
  })

  it('offers the skills of the plugins the boss installed, and not every marketplace it fetched', () => {
    const { home, env } = makeHome()
    const installed = join(home, '.claude/plugins/cache/acme/tools/1.0.0')
    writeSkill(join(installed, 'skills/misc/deploy-runbook'), 'deploy-runbook')
    writeSkill(join(home, '.claude/plugins/marketplaces/acme/skills/not-installed'), 'not-installed')
    mkdirSync(join(home, '.claude/plugins'), { recursive: true })
    writeFileSync(
      join(home, '.claude/plugins/installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'tools@acme': [{ scope: 'user', installPath: installed }] } }),
    )

    const groups = scan(env)

    expect(names(groups, 'plugins')).toEqual(['deploy-runbook'])
    expect(group(groups, 'plugins')?.path).toBe(join(home, '.claude/plugins'))
  })

  it('reads the skill folders of the repos this Company works in', () => {
    const { home, env } = makeHome()
    const repo = join(home, 'code/acme')
    writeSkill(join(repo, '.claude/skills/repo-one'), 'repo-one')
    writeSkill(join(repo, '.opencode/skill/repo-two'), 'repo-two')

    const groups = scan(env, [], [repo])

    expect(
      groups.filter((entry) => entry.source === 'repo').flatMap((entry) => entry.skills.map((s) => s.name)),
    ).toEqual(['repo-one', 'repo-two'])
  })

  it('takes the name from the front matter, normalised to what a skill name may be', () => {
    const { home, env } = makeHome()
    writeSkill(join(home, '.agents/skills/whatever'), 'Deploy Runbook')

    expect(names(scan(env), 'shared')).toEqual(['deploy-runbook'])
  })

  it('says a folder is added when this Company already has a skill at it, and offers nothing', () => {
    const { home, env } = makeHome()
    const at = writeSkill(join(home, '.agents/skills/held'), 'held')
    const sources = createSkillSources({ env, platform: 'linux' })

    const groups = sources.scan([{ name: 'held', path: at }])

    expect(groups[0]?.skills[0]).toMatchObject({ added: true, problem: null })
    expect(sources.take(at)).toBeNull()
  })

  it('says plainly when the name is taken by another folder, and offers nothing', () => {
    const { home, env } = makeHome()
    const at = writeSkill(join(home, '.agents/skills/held'), 'held')
    const sources = createSkillSources({ env, platform: 'linux' })

    const groups = sources.scan([{ name: 'held', path: join(home, 'somewhere/else') }])

    expect(groups[0]?.skills[0]).toMatchObject({
      added: false,
      problem: 'This Company already has a skill named held',
    })
    expect(sources.take(at)).toBeNull()
  })

  it('hands the catalogue the folder it really is, and nothing the scan did not offer', () => {
    const { home, env } = makeHome()
    const real = writeSkill(join(home, '.agents/skills/ai-sdk'), 'ai-sdk')
    mkdirSync(join(home, '.claude/skills'), { recursive: true })
    symlinkSync(real, join(home, '.claude/skills/ai-sdk'), LINK_KIND)
    const sources = createSkillSources({ env, platform: 'linux' })

    const found = sources.scan([])[0]?.skills[0]

    expect(sources.take(found?.path ?? '')).toEqual({ name: 'ai-sdk', path: found?.path })
    expect(sources.take(join(home, '.claude/skills/ai-sdk'))).toBeNull()
  })

  it('finds the folders of a home inside WSL, spelled the way this Windows reaches them', () => {
    const { home } = makeHome()
    const distroHome = join(home, 'wsl-home')
    writeSkill(join(distroHome, '.agents/skills/in-the-distro'), 'in-the-distro')

    const groups = createSkillSources({
      env: { HOME: join(home, 'windows-home') },
      platform: 'win32',
      wslHomes: () => [distroHome],
    }).scan([])

    expect(groups.flatMap((entry) => entry.skills.map((skill) => skill.path))).toEqual([
      expect.stringContaining('in-the-distro'),
    ])
  })

  it('reads no further than the front matter', () => {
    const { home } = makeHome()
    const at = join(home, 'huge')
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, 'SKILL.md'), `---\nname: huge\ndescription: short\n---\n\n${'x'.repeat(200_000)}`)

    expect(frontMatter(join(at, 'SKILL.md'))).toEqual({ name: 'huge', description: 'short' })
  })

  it('reads a description folded over several lines as the one sentence it is', () => {
    const { home } = makeHome()
    const at = join(home, 'folded')
    mkdirSync(at, { recursive: true })
    writeFileSync(join(at, 'SKILL.md'), '---\nname: folded\ndescription: >-\n  one line\n  and the next\n---\n')

    expect(frontMatter(join(at, 'SKILL.md'))).toEqual({ name: 'folded', description: 'one line and the next' })
  })
})
