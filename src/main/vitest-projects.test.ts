import { describe, expect, it } from 'vitest'
import config from '../../vitest.config'

/**
 * The suite is three projects, and `pnpm test` runs two of them. The third talks to real CLIs on
 * the boss's own login: a run that quietly picked it up would spend usage and take minutes, which
 * is exactly the accident this test exists to make impossible (T183).
 */

type Project = { test: { name: string; environment: string; include: string[]; exclude?: string[]; isolate?: boolean } }

const projects = (config.test?.projects ?? []) as unknown as Project[]
const byName = new Map(projects.map((project) => [project.test.name, project.test]))

/** Whether a glob from `include` or `exclude` matches a path, for the shapes this config uses. */
function matches(glob: string, path: string): boolean {
  const pattern = glob
    .split('**/')
    .join('\u0000')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .split('\u0000')
    .join('(?:.*/)?')
  return new RegExp(`^${pattern}$`).test(path)
}

const picks = (name: string, path: string): boolean => {
  const project = byName.get(name)
  if (!project) return false
  return (
    project.include.some((glob) => matches(glob, path)) && !(project.exclude ?? []).some((glob) => matches(glob, path))
  )
}

describe('the suite’s projects', () => {
  it('is unit, dom and real, and nothing else', () => {
    expect([...byName.keys()]).toEqual(['unit', 'dom', 'real'])
  })

  it('gives each one the environment its name promises', () => {
    expect(byName.get('unit')?.environment).toBe('node')
    expect(byName.get('dom')?.environment).toBe('jsdom')
    expect(byName.get('real')?.environment).toBe('node')
  })

  it('never lets `pnpm test` pick up an integration test', () => {
    const itest = 'src/main/integration/real-claude-loop.itest.ts'

    expect(picks('unit', itest), '`pnpm test` runs unit').toBe(false)
    expect(picks('dom', itest), '`pnpm test` runs dom').toBe(false)
    expect(picks('real', itest), '`pnpm test:claude` runs real').toBe(true)
  })

  it('sorts a test into exactly one of unit and dom, by its name', () => {
    const unit = 'src/main/engine/board.test.ts'
    const dom = 'src/renderer/src/shell/sidebar-pin.dom.test.tsx'

    expect([picks('unit', unit), picks('dom', unit)]).toEqual([true, false])
    expect([picks('unit', dom), picks('dom', dom)]).toEqual([false, true])
  })

  it('keeps every project isolated: the engine writes real files and real databases', () => {
    for (const [name, project] of byName) expect(project.isolate, name).toBe(true)
  })
})
