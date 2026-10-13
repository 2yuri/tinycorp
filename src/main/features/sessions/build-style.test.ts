import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BUILD_STYLE, LEAN_LADDER, LEAN_RULES } from '../../../shared/build-style'
import { migrate } from '../../core/engine/migrations'
import { createBuildStyleSettings } from './build-style'

/** An empty Company database with every migration applied, the setting's own among them. */
function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

describe('The Company’s build style', () => {
  it('is Standard until the boss turns Lean builder on, including in a Company made before it', () => {
    expect(createBuildStyleSettings(database()).buildStyle()).toBe('standard')
    expect(DEFAULT_BUILD_STYLE).toBe('standard')
  })

  it('round-trips through the migration’s one row, and keeps only the last value', () => {
    const db = database()
    const build = createBuildStyleSettings(db)

    expect(build.setBuildStyle('lean')).toBe('lean')
    expect(build.buildStyle()).toBe('lean')
    build.setBuildStyle('standard')

    expect(build.buildStyle()).toBe('standard')
    expect(db.prepare('SELECT COUNT(*) AS n FROM build_style_setting').get()).toMatchObject({ n: 1 })
  })

  it('reads back as Standard rather than refusing when the row holds something this build forgot', () => {
    const db = database()
    db.prepare(`INSERT INTO build_style_setting (id, style) VALUES (1, 'ultra')`).run()

    expect(createBuildStyleSettings(db).buildStyle()).toBe('standard')
  })

  it('refuses a style it does not know rather than writing it', () => {
    const build = createBuildStyleSettings(database())

    expect(() => build.setBuildStyle('ponytail' as never)).toThrow(/Unknown build style/)
    expect(build.buildStyle()).toBe('standard')
  })

  it('tells one change apart from the next', () => {
    let changes = 0
    const build = createBuildStyleSettings(database(), () => changes++)

    build.setBuildStyle('lean')
    build.setBuildStyle('standard')

    expect(changes).toBe(2)
  })
})

describe('The ladder Lean builder adds', () => {
  it('is the seven rungs the card draws, in the same order and with no second copy of them', () => {
    expect(LEAN_LADDER).toHaveLength(7)
    for (const [index, rung] of LEAN_LADDER.entries()) {
      expect(LEAN_RULES).toContain(`${index + 1}. ${rung}`)
    }
  })

  it('never cuts what a lazy solution must not cut, and says so in the section itself', () => {
    const text = LEAN_RULES.join('\n')

    expect(text).toMatch(/Never cut: validation at a trust boundary/)
    expect(text).toMatch(/error handling that prevents data loss/)
    expect(text).toMatch(/security or accessibility/)
  })

  it('shortens the solution and not the reading, which is the failure the ladder invites', () => {
    expect(LEAN_RULES.join('\n')).toMatch(/shortens the solution, never the reading/)
  })
})
