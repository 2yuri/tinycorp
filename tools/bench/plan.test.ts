import { describe, expect, it } from 'vitest'
import { armIds, armsOfMode } from './arms.mjs'
import { FIXTURES, readNumstat } from './fixture.mjs'
import {
  chosenArms,
  chosenTasks,
  estimate,
  MODES,
  modeOf,
  overBudget,
  parseArgs,
  planCells,
  readTasks,
  refusal,
  resultsName,
  runDate,
  unitsOf,
} from './plan.mjs'

/**
 * What a `pnpm bench:tokens` run will do, before it spends anything (T190).
 *
 * The cost guard is the part with teeth: a run that starts by accident is eighty Claude Code
 * sessions of the boss's own subscription, and a run that starts against an API key is a bill on
 * an account nobody meant to charge.
 */

describe('the cost guard', () => {
  it('refuses a real run that was not asked for with --yes', () => {
    expect(refusal({ env: {}, yes: false, dryRun: false })).toMatch(/--yes/)
    expect(refusal({ env: {}, yes: true, dryRun: false })).toBeNull()
    expect(refusal({ env: {}, yes: false, dryRun: true })).toBeNull()
  })

  it('refuses outright when an API key is set, even with --yes and even for a dry run', () => {
    expect(refusal({ env: { ANTHROPIC_API_KEY: 'sk-x' }, yes: true, dryRun: false })).toMatch(/subscription/)
    expect(refusal({ env: { ANTHROPIC_AUTH_TOKEN: 't' }, yes: true, dryRun: true })).toMatch(/subscription/)
  })

  it('prices a run by its cells, so the dry run’s number moves with --n and --arms', () => {
    const arms = chosenArms(['baseline', 'rtk'])
    const tasks = readTasks()
    const small = estimate(planCells({ tasks, arms, n: 1 }))
    const big = estimate(planCells({ tasks, arms, n: 3 }))
    expect(small.cells).toBe(tasks.length * 2)
    expect(big.costUsd).toBeGreaterThan(small.costUsd)
    expect(big.cells).toBe(small.cells * 3)
  })
})

describe('the command line', () => {
  it('defaults to Sonnet, n=3 and every arm, which is what the ticket asks for', () => {
    const options = parseArgs([])
    expect(options.model).toBe('sonnet')
    expect(options.n).toBe(3)
    expect(options.arms).toBeNull()
    expect(chosenArms(options.arms).map((arm) => arm.id)).toEqual(armsOfMode('solo').map((arm) => arm.id))
    expect(armIds()).toContain('dm-terse')
    expect(options.dryRun).toBe(false)
    expect(options.yes).toBe(false)
  })

  it('takes --n 2 and --n=2 the same way', () => {
    expect(parseArgs(['--n', '2']).n).toBe(2)
    expect(parseArgs(['--n=2']).n).toBe(2)
  })

  it('refuses a flag it does not know rather than ignoring it and running the wrong thing', () => {
    expect(() => parseArgs(['--nn', '2'])).toThrow(/--nn/)
    expect(() => parseArgs(['-n', '2'])).toThrow()
    expect(() => parseArgs(['--n'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--n', '0'])).toThrow(/positive/)
  })

  it('names the arm or task that does not exist instead of quietly running fewer', () => {
    expect(() => chosenArms(['baseline', 'nope'])).toThrow(/nope/)
    expect(() => chosenTasks(readTasks(), ['nope'])).toThrow(/nope/)
    expect(chosenTasks(readTasks(), ['csv-export']).map((task) => task.id)).toEqual(['csv-export'])
  })
})

describe('the tickets', () => {
  const tasks = readTasks()

  it('are the eight the ticket asks for, each with a unique id', () => {
    expect(tasks).toHaveLength(8)
    expect(new Set(tasks.map((task) => task.id)).size).toBe(8)
    for (const task of tasks) expect(task.prompt.length).toBeGreaterThan(20)
  })

  it('include the two over-build traps, so an arm that builds less has somewhere to show it', () => {
    const traps = tasks.filter((task) => task.trap !== 'none').map((task) => task.trap)
    expect(traps).toContain('a date picker')
    expect(traps).toContain('a CSV writer')
  })

  it('are of mixed size, so the answer is not one ticket’s answer', () => {
    expect(new Set(tasks.map((task) => task.size)).size).toBeGreaterThan(2)
  })
})

describe('the order cells run in', () => {
  it('is task-major and then whole repeats, so a run stopped halfway is still a comparison', () => {
    const arms = chosenArms(['baseline', 'rtk'])
    const tasks = chosenTasks(readTasks(), ['csv-export', 'sort-users'])
    const cells = planCells({ tasks, arms, n: 2 })
    expect(cells.slice(0, 4).map((cell) => cell.id)).toEqual([
      'csv-export__baseline__1',
      'csv-export__rtk__1',
      'csv-export__baseline__2',
      'csv-export__rtk__2',
    ])
    expect(cells[4]?.task.id).toBe('sort-users')
  })

  it('leaves every arm the same number of cells wherever --budget stops it', () => {
    const arms = chosenArms(['baseline', 'rtk'])
    const cells = planCells({ tasks: chosenTasks(readTasks(), ['csv-export']), arms, n: 3 })
    for (const stop of [2, 4, 6]) {
      const ran = cells.slice(0, stop)
      const perArm = arms.map((arm) => ran.filter((cell) => cell.arm.id === arm.id).length)
      expect(new Set(perArm).size, `a run stopped after ${stop} cells is lopsided`).toBe(1)
    }
  })
})

describe('what the agent left behind', () => {
  it('counts lines added and removed, and drops lockfiles and generated files', () => {
    const stat = readNumstat(
      [
        '12\t3\tsrc/a.tsx',
        '4000\t0\tpackage-lock.json',
        '900\t1\tsrc/routeTree.gen.ts',
        '-\t-\tlogo.png',
        '5\t0\tsrc/b.ts',
      ].join('\n'),
    )
    expect(stat).toEqual({ added: 17, removed: 3, files: ['src/a.tsx', 'src/b.ts'] })
  })

  it('never counts anything under node_modules, which every workspace links to', () => {
    expect(readNumstat('99\t0\tnode_modules/x/index.js').added).toBe(0)
  })
})

describe('the fixture', () => {
  it('is pinned by a full commit sha, not a branch that moves under the benchmark', () => {
    for (const fixture of Object.values(FIXTURES)) {
      expect(fixture.commit).toMatch(/^[0-9a-f]{40}$/)
      expect(fixture.root.length).toBeGreaterThan(0)
    }
  })
})

describe('the results file', () => {
  it('is named for the day and the model, so two runs never overwrite each other silently', () => {
    expect(resultsName(new Date('2026-09-23T18:00:00Z'), 'sonnet')).toBe('2026-09-23-sonnet.md')
    expect(resultsName(new Date('2026-09-23T18:00:00Z'), 'opus')).toBe('2026-09-23-opus.md')
  })
})

describe('rescoring a run that has already been paid for', () => {
  it('needs neither --yes nor a key check, because it spends nothing', () => {
    expect(refusal({ env: {}, yes: false, dryRun: false, rescore: '/tmp/runs/x' })).toBeNull()
    expect(refusal({ env: { ANTHROPIC_API_KEY: 'sk-x' }, yes: false, dryRun: false, rescore: '/tmp/x' })).toBeNull()
  })

  it('writes the date the run happened, not the date it was rescored', () => {
    expect(resultsName(runDate('/tmp/tinycorp-bench/runs/2026-09-23T22-10-59-543Z'), 'sonnet')).toBe(
      '2026-09-23-sonnet.md',
    )
    expect(runDate('not-a-stamp').getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('is a flag like any other', () => {
    expect(parseArgs(['--rescore', '/tmp/runs/x']).rescore).toBe('/tmp/runs/x')
    expect(parseArgs([]).rescore).toBeNull()
  })
})

describe('the shape of a run (T197)', () => {
  it('is solo unless asked otherwise, and every mode has an arm and a unit', () => {
    expect(parseArgs([]).mode).toBe('solo')
    expect(parseArgs(['--mode', 'long']).mode).toBe('long')
    for (const mode of Object.values(MODES)) {
      expect(chosenArms(null, mode).length, `mode ${mode.id} has no arms`).toBeGreaterThan(1)
      expect(unitsOf(mode, readTasks()).length, `mode ${mode.id} has no units`).toBeGreaterThan(0)
      expect(mode.costPerCellUsd).toBeGreaterThan(0)
    }
    expect(() => modeOf('nope')).toThrow(/nope/)
  })

  it('refuses an arm that means nothing in the mode asked for, rather than running it anyway', () => {
    expect(() => chosenArms(['terse-voice'], modeOf('long'))).toThrow(/baseline, rtk/)
    expect(() => chosenArms(['dm-terse'], modeOf('solo'))).toThrow(/not one of mode solo/)
    expect(chosenArms(['rtk'], modeOf('long')).map((arm) => arm.id)).toEqual(['rtk'])
  })

  it('prices a long or duo cell above a solo one, because it is several sessions of work', () => {
    const cells = planCells({ tasks: readTasks().slice(0, 1), arms: chosenArms(['baseline'], modeOf('long')), n: 1 })
    expect(estimate(cells, modeOf('long')).costUsd).toBeGreaterThan(estimate(cells).costUsd)
    expect(estimate(cells, modeOf('duo')).costUsd).toBeGreaterThan(estimate(cells).costUsd)
  })

  it('gives a round of its own a results file of its own, so two rounds on one day are two files', () => {
    const day = new Date('2026-09-24T10:00:00Z')
    expect(resultsName(day, 'sonnet')).toBe('2026-09-24-sonnet.md')
    expect(resultsName(day, 'sonnet', 'solo')).toBe('2026-09-24-sonnet.md')
    expect(resultsName(day, 'sonnet', 'long')).toBe('2026-09-24-sonnet-long.md')
  })
})

describe('the run’s own budget', () => {
  it('lets a run go on while the next cell still fits', () => {
    expect(overBudget({ budgetUsd: 40, spentUsd: 10, nextUsd: 2.4 })).toBeNull()
    expect(overBudget({ budgetUsd: 40, spentUsd: 37.6, nextUsd: 2.4 })).toBeNull()
  })

  it('stops before the cell that would pass it, and says what it had spent', () => {
    const reason = overBudget({ budgetUsd: 40, spentUsd: 38, nextUsd: 2.4 })
    expect(reason).toMatch(/\$40\.00/)
    expect(reason).toMatch(/\$38\.00 spent/)
  })

  it('caps nothing when no --budget was given, which is what T190’s own runs did', () => {
    expect(overBudget({ budgetUsd: null, spentUsd: 1000, nextUsd: 10 })).toBeNull()
    expect(parseArgs([]).budgetUsd).toBeNull()
    expect(parseArgs(['--budget', '12.5']).budgetUsd).toBe(12.5)
    expect(() => parseArgs(['--budget', '0'])).toThrow(/positive/)
  })
})
