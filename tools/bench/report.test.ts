import { describe, expect, it } from 'vitest'
import type { DiffStat, TestOutcome } from './fixture.mjs'
import type { MeasuredCell } from './report.mjs'
import {
  deltaLabel,
  iqr,
  landed,
  median,
  percentOf,
  quartiles,
  renderReport,
  summarise,
  tokens,
  usd,
} from './report.mjs'
import type { CellResult, RtkGain } from './session.mjs'

/**
 * What a `pnpm bench:tokens` run is allowed to say (T190).
 *
 * The ticket's one hard rule is *never round a loss into a win*, and the reason it is a rule is
 * that the ponytail benchmark found a terse-prose skill spending 7% **more** tokens across whole
 * sessions. So the tests below are mostly one test written several ways: give the report an arm
 * that lost, and check it says so.
 */

/** The result a cell produced when nothing about it is the point of the test. */
const RESULT: CellResult = {
  ok: true,
  subtype: 'success',
  sessionId: 'x',
  model: 'claude-sonnet-5',
  inputTokens: 10,
  outputTokens: 3000,
  cacheReadTokens: 90_000,
  cacheWriteTokens: 6990,
  costUsd: 0.4,
  turns: 8,
  apiMs: 1000,
  permissionDenials: 0,
}

/**
 * One measured cell. `result: null` is spelled out rather than spread over a finished cell, so
 * a cell that produced nothing is built as one instead of asserted into one.
 */
interface CellOverrides {
  arm: string
  task: string
  ms?: number
  tokensTotal?: number | null
  diff?: DiffStat | null
  tests?: TestOutcome | null
  rtk?: RtkGain | null
  breaches?: string[]
  error?: string | null
  result?: Partial<CellResult> | null
}

function cell({ result, ...over }: CellOverrides): MeasuredCell {
  return {
    id: `${over.task}__${over.arm}__1`,
    run: 1,
    ms: 60_000,
    tokensTotal: 100_000,
    diff: { added: 40, removed: 2, files: ['src/a.tsx'] },
    tests: { passed: true, code: 0, ms: 5000, output: '' },
    rtk: null,
    breaches: [],
    error: null,
    ...over,
    result: result === null ? null : { ...RESULT, ...result },
  }
}

describe('the statistics', () => {
  it('takes a median, not a mean, because three agent sessions are not a tight distribution', () => {
    expect(median([1, 2, 100])).toBe(2)
    expect(median([1, 2, 3, 100])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('reports an interquartile range beside every median', () => {
    expect(quartiles([1, 2, 3, 4])).toEqual({ q1: 1.75, q3: 3.25 })
    expect(iqr([1, 2, 3, 4])).toBe(1.5)
    expect(iqr([])).toBeNull()
  })

  it('never rounds a loss into a win', () => {
    expect(percentOf(107, 100)).toBe(107)
    expect(deltaLabel(percentOf(107, 100))).toBe('+7%')
    expect(deltaLabel(percentOf(93, 100))).toBe('-7%')
    expect(deltaLabel(percentOf(100, 100))).toBe('0%')
  })

  it('has no answer rather than a zero when there is no baseline to divide by', () => {
    expect(percentOf(5, 0)).toBeNull()
    expect(percentOf(5, null)).toBeNull()
    expect(deltaLabel(null)).toBe('—')
  })

  it('prints a token count and a cost without inventing a digit', () => {
    expect(tokens(1_234_567)).toBe('1.23M')
    expect(tokens(420_000)).toBe('420K')
    expect(tokens(980)).toBe('980')
    expect(usd(0.4)).toBe('$0.400')
    expect(usd(null)).toBe('—')
  })
})

describe('summarising an arm', () => {
  it('counts a cell that produced no result as failed and leaves it out of every median', () => {
    const cells = [
      cell({ arm: 'rtk', task: 'a', tokensTotal: 100 }),
      cell({ arm: 'rtk', task: 'a', result: null, tokensTotal: null, error: 'timed out' }),
    ]
    const one = summarise(cells)
    expect(one.n).toBe(2)
    expect(one.ran).toBe(1)
    expect(one.failed).toBe(1)
    expect(one.totalTokens.median).toBe(100)
  })

  it('counts green suites out of the cells that ran, never out of the cells that were planned', () => {
    const cells = [
      cell({ arm: 'rtk', task: 'a' }),
      cell({ arm: 'rtk', task: 'a', tests: { passed: false, code: 1, ms: 10, output: 'red' } }),
    ]
    expect(summarise(cells).testsPassed).toBe(1)
    expect(summarise(cells).testsRun).toBe(2)
  })

  it('has no RTK number at all for an arm with no RTK, rather than a zero that reads as "saved nothing"', () => {
    expect(summarise([cell({ arm: 'baseline', task: 'a' })]).rtkSaved).toBeNull()
  })
})

describe('the results file', () => {
  const tasks = [{ id: 'csv-export', size: 'medium', trap: 'a CSV writer' }]
  const arms = ['baseline', 'terse-voice']
  const run = {
    model: 'sonnet',
    n: 2,
    date: '2026-09-23',
    fixture: 'a repo',
    commit: 'abcdef1234567890',
    command: 'pnpm bench:tokens --yes --n 2',
    jsonl: '/tmp/cells.jsonl',
    claudeVersion: '2.1.281',
    rtkVersion: 'rtk 0.49.0',
    limitations: ['n=2 is two sessions, not a distribution.'],
  }

  it('prints an arm that spent more as more than 100%, in the same table as one that spent less', () => {
    const cells = [
      cell({ arm: 'baseline', task: 'csv-export', tokensTotal: 100_000 }),
      cell({ arm: 'baseline', task: 'csv-export', tokensTotal: 100_000 }),
      cell({ arm: 'terse-voice', task: 'csv-export', tokensTotal: 107_000 }),
      cell({ arm: 'terse-voice', task: 'csv-export', tokensTotal: 107_000 }),
    ]
    const text = renderReport({ run, cells, arms, tasks })
    expect(text).toContain('| `terse-voice` | 107K | 107 ')
    expect(text).toContain('above 100 means the arm spent more')
  })

  it('says which cells were contaminated instead of averaging them in silently', () => {
    const cells = [
      cell({ arm: 'baseline', task: 'csv-export' }),
      cell({ arm: 'terse-voice', task: 'csv-export', breaches: ['hook SessionStart fired'] }),
    ]
    const text = renderReport({ run, cells, arms, tasks })
    expect(text).toContain('**1 of 2 cells were contaminated**')
    expect(text).toContain('hook SessionStart fired')
  })

  it('says so out loud when nothing was contaminated', () => {
    const cells = [cell({ arm: 'baseline', task: 'csv-export' }), cell({ arm: 'terse-voice', task: 'csv-export' })]
    const text = renderReport({ run, cells, arms, tasks })
    expect(text).toContain('no hook fired that its arm does not declare')
    expect(text).toContain('no MCP server was called that it does not declare')
  })

  it('lists the cells that produced no measurement, so an arm cannot win by failing', () => {
    const cells = [
      cell({ arm: 'baseline', task: 'csv-export' }),
      cell({ arm: 'terse-voice', task: 'csv-export', result: null, error: 'timed out' }),
    ]
    const text = renderReport({ run, cells, arms, tasks })
    expect(text).toContain('Cells with no measurement')
    expect(text).toContain('timed out')
  })

  it('carries every limitation it was given, and the command that would run it again', () => {
    const cells = [cell({ arm: 'baseline', task: 'csv-export' })]
    const text = renderReport({ run, cells, arms: ['baseline'], tasks })
    expect(text).toContain('n=2 is two sessions, not a distribution.')
    expect(text).toContain('pnpm bench:tokens --yes --n 2')
    expect(text).toContain('2.1.281')
  })
})

describe('a run with no baseline arm', () => {
  it('prints a dash rather than a percentage of nothing', () => {
    const text = renderReport({
      run: {
        model: 'sonnet',
        n: 1,
        date: '2026-09-23',
        fixture: 'a repo',
        commit: 'abcdef1234567890',
        command: 'pnpm bench:tokens --yes --arms rtk',
        jsonl: '/tmp/cells.jsonl',
        claudeVersion: '2.1.281',
        rtkVersion: 'rtk 0.49.0',
        limitations: [],
      },
      cells: [cell({ arm: 'rtk', task: 'csv-export' })],
      arms: ['rtk'],
      tasks: [{ id: 'csv-export', size: 'medium', trap: 'a CSV writer' }],
    })
    expect(text).toContain('| `rtk` |')
    expect(text).not.toContain('NaN')
  })
})

describe('whether a duo cell’s ticket landed (T197)', () => {
  const dm = (authors: Record<string, number>) => ({
    messages: Object.values(authors).reduce((sum, one) => sum + one, 0),
    chars: 100,
    words: 20,
    estTokens: 25,
    elsewhere: 0,
    deliveries: 2,
    capped: false,
    byAuthor: Object.fromEntries(
      Object.entries(authors).map(([name, messages]) => [name, { messages, chars: 50, words: 10, estTokens: 13 }]),
    ),
  })

  it('needs all three: a green suite, code in the diff, and both Employees having written', () => {
    expect(landed({ ...cell({ arm: 'dm-terse', task: 'edit-comment' }), dm: dm({ Ada: 2, Vega: 1 }) })).toBe(true)
  })

  it('is false for a cell nobody talked in, however green the suite is', () => {
    expect(landed({ ...cell({ arm: 'dm-terse', task: 'edit-comment' }), dm: dm({ Ada: 2 }) })).toBe(false)
    expect(landed({ ...cell({ arm: 'dm-terse', task: 'edit-comment' }), dm: null })).toBe(false)
  })

  it('is false for a cell that wrote no code, or whose suite went red', () => {
    const talked = dm({ Ada: 1, Vega: 1 })
    expect(
      landed({
        ...cell({ arm: 'dm-terse', task: 'edit-comment', diff: { added: 0, removed: 0, files: [] } }),
        dm: talked,
      }),
    ).toBe(false)
    expect(
      landed({
        ...cell({ arm: 'dm-terse', task: 'edit-comment', tests: { passed: false, code: 1, ms: 10, output: 'red' } }),
        dm: talked,
      }),
    ).toBe(false)
  })
})

describe('the results file of a long run (T197)', () => {
  const run = {
    mode: 'long',
    unit: 'triple',
    shape: 'three tickets in one resumed session',
    model: 'sonnet',
    n: 1,
    date: '2026-09-24',
    fixture: 'a repo',
    commit: 'abcdef1234567890',
    command: 'pnpm bench:tokens --mode long --yes',
    jsonl: '/tmp/cells.jsonl',
    claudeVersion: '2.1.281',
    rtkVersion: 'rtk 0.49.0',
    limitations: [],
  }
  const leg = (id: string, kind: string, tokensTotal: number) => ({
    id,
    kind,
    sessionId: 'S',
    ms: 1000,
    result: { ...RESULT },
    tokensTotal,
  })
  const cells = [
    {
      ...cell({ arm: 'baseline', task: 'three-in-a-row' }),
      parts: [leg('t1', 'ticket', 100), leg('c1', 'checkpoint', 200)],
    },
    {
      ...cell({ arm: 'rtk', task: 'three-in-a-row' }),
      parts: [leg('t1', 'ticket', 110), leg('c1', 'checkpoint', 150)],
    },
  ]

  it('prints a row per leg, so a checkpoint is read apart from the ticket before it', () => {
    const text = renderReport({
      run,
      cells,
      arms: ['baseline', 'rtk'],
      tasks: [{ id: 'three-in-a-row', size: 'three tickets', trap: 'none' }],
    })
    expect(text).toContain('## Per leg')
    expect(text).toContain('| `t1` | ticket |')
    expect(text).toContain('| `c1` | checkpoint |')
    // The checkpoint is where RTK saved something and the ticket is where it did not: 75% and 110%.
    expect(text).toMatch(/\| `c1` \| checkpoint \| 200 \| — \| 150 \| 75 \|/)
    expect(text).toMatch(/\| `t1` \| ticket \| 100 \| — \| 110 \| 110 \|/)
  })
})

describe('the results file of a duo run (T197)', () => {
  const run = {
    mode: 'duo',
    unit: 'ticket',
    baseArm: 'dm-plain',
    shape: 'two Employees and a DM thread',
    model: 'sonnet',
    n: 1,
    date: '2026-09-24',
    fixture: 'a repo',
    commit: 'abcdef1234567890',
    command: 'pnpm bench:tokens --mode duo --yes',
    jsonl: '/tmp/cells.jsonl',
    claudeVersion: '2.1.281',
    rtkVersion: null,
    limitations: [],
  }
  const part = (role: string, tokensTotal: number) => ({
    id: `${role}-1`,
    kind: 'first',
    role,
    sessionId: role,
    ms: 1000,
    result: { ...RESULT },
    tokensTotal,
  })
  const traffic = (chars: number) => ({
    messages: 4,
    chars,
    words: Math.round(chars / 5),
    estTokens: Math.round(chars / 4),
    elsewhere: 0,
    deliveries: 3,
    capped: false,
    byAuthor: {
      Ada: { messages: 2, chars: chars / 2, words: 10, estTokens: chars / 8 },
      Vega: { messages: 2, chars: chars / 2, words: 10, estTokens: chars / 8 },
    },
  })
  const cells = [
    {
      ...cell({ arm: 'dm-plain', task: 'edit-comment', tokensTotal: 300 }),
      parts: [part('lead', 200), part('helper', 100)],
      dm: traffic(1000),
    },
    {
      ...cell({ arm: 'dm-terse', task: 'edit-comment', tokensTotal: 280 }),
      parts: [part('lead', 190), part('helper', 90)],
      dm: traffic(400),
    },
  ]
  const text = renderReport({
    run,
    cells,
    arms: ['dm-plain', 'dm-terse'],
    tasks: [{ id: 'edit-comment', size: 'medium', trap: 'none' }],
  })

  it('is a percentage of the plain arm, since a duo run has no baseline called baseline', () => {
    expect(text).toContain('percentage of `dm-plain`')
    expect(text).toContain('| `dm-terse` | 280 | 93.3 ')
  })

  it('prints what each Employee spent, and whether the ticket landed', () => {
    expect(text).toContain('## The two Employees')
    expect(text).toContain('| `dm-plain` | 200 | 100 | 300 | — | 3 | 1/1 |')
  })

  it('prints the thread itself in characters and words, with the doubled estimate beside them', () => {
    expect(text).toContain('## The DM thread')
    expect(text).toContain('| `dm-plain` | 4 | 1000 | 200 | 250 | — | 500 |')
    expect(text).toContain('| `dm-terse` | 4 | 400 | 80 | 100 | 40 | 200 |')
  })
})
