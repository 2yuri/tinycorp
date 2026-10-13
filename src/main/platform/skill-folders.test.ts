import { execFileSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { onDisk } from '../core/testing'
import { SKILL_COPY_MARKER, syncSkillFolder } from './skill-folders'

/**
 * What lands in a worktree when a skill is granted (T137).
 *
 * On disk, against a real git repo: a symlink is the whole point — the boss edits the folder once
 * and every Employee holding it sees the edit — and so is the git exclusion, because the app writes
 * into a worktree and never commits (decision 45).
 */

const FOLDER = '.claude/skills'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(): { worktree: string; skill(name: string, body?: string): { name: string; path: string } } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tinycorp-skills-')))
  dirs.push(root)
  const worktree = join(root, 'worktree')
  mkdirSync(worktree)
  execFileSync('git', ['init', '--quiet'], { cwd: worktree })
  return {
    worktree,
    skill(name, body = `# ${name}\n`) {
      const path = join(root, 'skills', name)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'SKILL.md'), body)
      return { name, path }
    },
  }
}

const inside = (worktree: string) =>
  readdirSync(join(worktree, FOLDER))
    .filter((name) => !name.startsWith('.'))
    .sort()

/** What `git status` would show as untracked in the worktree. */
function untracked(worktree: string): string[] {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: worktree, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

describe('A granted skill folder', () => {
  it('is a link to the boss’s own folder, so an edit there is an edit the Employee sees', () => {
    const { worktree, skill } = setup()
    const checklist = skill('review-checklist')

    syncSkillFolder(worktree, FOLDER, [checklist])

    const at = join(worktree, FOLDER, 'review-checklist')
    expect(lstatSync(at).isSymbolicLink(), 'a copy would go stale the moment the boss edits it').toBe(true)
    writeFileSync(join(checklist.path, 'SKILL.md'), '# edited\n')
    expect(readFileSync(join(at, 'SKILL.md'), 'utf8')).toBe('# edited\n')
  })

  it('is git-excluded, so nothing the app writes into a worktree can be committed', () => {
    const { worktree, skill } = setup()

    syncSkillFolder(worktree, FOLDER, [skill('review-checklist')])

    expect(untracked(worktree), 'decision 45: the app writes into a worktree and never commits').toEqual([])
  })

  it('goes away when the grant does, and the ungranted one was never there', () => {
    const { worktree, skill } = setup()
    const checklist = skill('review-checklist')
    const runbook = skill('deploy-runbook')

    syncSkillFolder(worktree, FOLDER, [checklist, runbook])
    expect(inside(worktree)).toEqual(['deploy-runbook', 'review-checklist'])

    syncSkillFolder(worktree, FOLDER, [runbook])
    expect(inside(worktree)).toEqual(['deploy-runbook'])

    syncSkillFolder(worktree, FOLDER, [])
    expect(inside(worktree)).toEqual([])
  })

  it('is left alone when it is already there, rather than relinked every time', () => {
    const { worktree, skill } = setup()
    const checklist = skill('review-checklist')

    syncSkillFolder(worktree, FOLDER, [checklist])
    const first = lstatSync(join(worktree, FOLDER, 'review-checklist')).ino

    expect(syncSkillFolder(worktree, FOLDER, [checklist])).toEqual(['review-checklist'])
    expect(lstatSync(join(worktree, FOLDER, 'review-checklist')).ino).toBe(first)
  })

  it('points where the grant does after the boss moves the folder', () => {
    const { worktree, skill } = setup()
    syncSkillFolder(worktree, FOLDER, [skill('review-checklist')])
    const moved = skill('review-checklist-moved')

    syncSkillFolder(worktree, FOLDER, [{ name: 'review-checklist', path: moved.path }])

    expect(readFileSync(join(worktree, FOLDER, 'review-checklist', 'SKILL.md'), 'utf8')).toContain(
      'review-checklist-moved',
    )
  })

  it('is left out when its folder is not on this Mac, and throws nothing', () => {
    const { worktree } = setup()

    expect(() =>
      syncSkillFolder(worktree, FOLDER, [{ name: 'pen-handoff', path: onDisk('/nowhere/pen-handoff') }]),
    ).not.toThrow()

    expect(readdirSync(worktree)).not.toContain('.claude')
  })

  it('never shadows or removes a skill folder the repo keeps itself', () => {
    const { worktree, skill } = setup()
    const own = join(worktree, FOLDER, 'review-checklist')
    mkdirSync(own, { recursive: true })
    writeFileSync(join(own, 'SKILL.md'), '# the repo’s own\n')

    syncSkillFolder(worktree, FOLDER, [skill('review-checklist')])
    syncSkillFolder(worktree, FOLDER, [])

    expect(readFileSync(join(own, 'SKILL.md'), 'utf8'), 'TinyCorp removes only what it could have put there').toBe(
      '# the repo’s own\n',
    )
  })

  it('removes a copy it made itself, which carries its marker', () => {
    const { worktree, skill } = setup()
    const copied = join(worktree, FOLDER, 'deploy-runbook')
    mkdirSync(copied, { recursive: true })
    writeFileSync(join(copied, SKILL_COPY_MARKER), 'Put here by TinyCorp.\n')

    syncSkillFolder(worktree, FOLDER, [skill('review-checklist')])

    expect(inside(worktree)).toEqual(['review-checklist'])
  })

  it('does nothing at all for a worktree that is not on disk any more', () => {
    const { skill } = setup()

    expect(syncSkillFolder(onDisk('/nowhere/worktree'), FOLDER, [skill('review-checklist')])).toEqual([])
  })
})
