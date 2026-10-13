import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  CAVEMAN_CARD_RULES,
  CAVEMAN_INTENSITIES,
  CAVEMAN_MEASURED,
  CAVEMAN_UNMEASURED,
  cavemanMeasuredBlock,
  cavemanRules,
  DEFAULT_CAVEMAN,
} from '../../../shared/caveman'
import { migrate } from '../../core/engine/migrations'
import { createCavemanSettings } from './caveman'

/** An empty Company database with every migration applied, the setting's own among them. */
function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

describe('The Company’s caveman setting', () => {
  it('is off until the boss turns it on, including in a Company made before it', () => {
    expect(createCavemanSettings(database()).caveman()).toBe('off')
    expect(DEFAULT_CAVEMAN).toBe('off')
  })

  it('round-trips through the migration’s one row, and keeps only the last value', () => {
    const db = database()
    const caveman = createCavemanSettings(db)

    expect(caveman.setCaveman('ultra')).toBe('ultra')
    expect(caveman.caveman()).toBe('ultra')
    caveman.setCaveman('lite')

    expect(caveman.caveman()).toBe('lite')
    expect(db.prepare('SELECT COUNT(*) AS n FROM caveman_setting').get()).toMatchObject({ n: 1 })
  })

  it('reads back as off rather than refusing when the row holds something this build forgot', () => {
    const db = database()
    db.prepare(`INSERT INTO caveman_setting (id, level) VALUES (1, 'wenyan')`).run()

    expect(createCavemanSettings(db).caveman()).toBe('off')
  })

  it('refuses a level it does not know rather than writing it', () => {
    const caveman = createCavemanSettings(database())

    expect(() => caveman.setCaveman('grunt' as never)).toThrow(/Unknown caveman level/)
    expect(caveman.caveman()).toBe('off')
  })

  it('tells one change apart from the next', () => {
    let changes = 0
    const caveman = createCavemanSettings(database(), () => changes++)

    caveman.setCaveman('full')
    caveman.setCaveman('off')

    expect(changes).toBe(2)
  })
})

describe('The section Caveman adds', () => {
  it('is nothing at all while the add-on is off', () => {
    expect(cavemanRules('off')).toEqual([])
  })

  it('is one section at each intensity, and only the first line differs', () => {
    const sections = CAVEMAN_INTENSITIES.map((level) => cavemanRules(level).join('\n'))
    for (const text of sections) {
      expect(text).toContain('## How you answer the boss')
      expect(text.match(/## /g)).toHaveLength(1)
    }
    // Everything after the opening line is the same three ways: the scope is not a dial.
    const scopes = sections.map((text) => text.split('\n').slice(4).join('\n'))
    expect(new Set(scopes).size).toBe(1)
  })

  /**
   * The card is the boss's copy of these rules and the section is the Employee's, so the two are
   * different strings by necessity — the card says "to you" where the section says "to the boss".
   * This is what keeps them saying the same three things, so the card can never promise a limit
   * the Employee was never told about.
   */
  it('says everything the card promises the boss it does', () => {
    const text = cavemanRules('full').join('\n')

    expect(CAVEMAN_CARD_RULES).toHaveLength(3)
    // Only in messages to the boss; a colleague is the other voice's business.
    expect(text).toMatch(/It reaches one place and no other: a message addressed to the boss/)
    expect(text).toMatch(/Never to a colleague/)
    // The payload, word for word.
    for (const kept of ['code', 'a command', 'a file path', 'an error message', 'a security warning']) {
      expect(text, `the section drops ${kept}, which the card says it keeps`).toContain(kept)
    }
    expect(text).toMatch(/word for word/)
    // The written record, in full sentences.
    for (const kept of ['a commit message', 'a pull request', 'a plan', 'ticket text']) {
      expect(text, `the section drops ${kept}, which the card says stays whole`).toContain(kept)
    }
    expect(text).toMatch(/stay in full sentences/)
  })

  it('errs toward full sentences when an Employee cannot tell who it is writing to', () => {
    expect(cavemanRules('ultra').join('\n')).toMatch(/When you cannot tell, write full sentences/)
  })

  /**
   * How you write carries "No fragments here", which Full and Ultra contradict for exactly one
   * audience. An Employee handed both and told nothing would have to pick, and it would pick the
   * one it read last.
   */
  it('says out loud which bullet of How you write it narrows, rather than leaving the two to fight', () => {
    expect(cavemanRules('full').join('\n')).toMatch(/narrows one bullet of How you write/)
  })

  /**
   * The other contradiction, and the sharper one: every wake prompt for a boss-facing message ends
   * with `voiceHint`'s own clause, "The boss can read this → plain words, full sentences." An
   * Employee meets that on every single turn and the section only at spawn, so the section has to
   * say what the clause is for. Nothing in the engine changes for it, which is why the section is
   * the place it is said.
   */
  it('settles the wake prompt’s own voice clause, which an Employee reads on every turn', () => {
    const text = cavemanRules('lite').join('\n')

    expect(text).toContain('The boss can read this \u2192 plain words, full sentences.')
    expect(text).toMatch(/not an instruction to lengthen an answer this section shortened/)
  })
})

describe('What the card may claim', () => {
  /**
   * No token claim ships unmeasured (AGENTS.md), and this is the switch that enforces it: until
   * `tools/bench/results/` holds a run of the `caveman` arm, `CAVEMAN_MEASURED` is null, the three
   * tiles read `—` and the toggle cannot be moved.
   */
  it('is three dashes and a disabled toggle while nothing has been measured', () => {
    const block = cavemanMeasuredBlock(null)

    expect(block.enabled).toBe(false)
    expect(block.foot).toBe(CAVEMAN_UNMEASURED)
    expect(block.tiles.map((tile) => tile.change)).toEqual(['—', '—', '—'])
    expect(block.tiles.map((tile) => tile.what)).toEqual(['output tokens', 'cost', 'answers right'])
  })

  it('is the numbers and the run behind them once there is a results file', () => {
    const block = cavemanMeasuredBlock({
      tiles: [
        { change: '−40%', what: 'output tokens' },
        { change: '−8%', what: 'cost' },
        { change: '100%', what: 'answers right' },
      ],
      caveat: '30 Sonnet cells on 1 ticket.',
    })

    expect(block.enabled).toBe(true)
    expect(block.foot).toBe('30 Sonnet cells on 1 ticket.')
    expect(block.tiles[0]?.change).toBe('−40%')
  })

  it('ships unmeasured, which is what the frame draws and what the toggle is disabled for', () => {
    expect(CAVEMAN_MEASURED).toBeNull()
    expect(cavemanMeasuredBlock().enabled).toBe(false)
  })
})
