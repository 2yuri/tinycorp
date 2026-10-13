import { describe, expect, it } from 'vitest'
import { CHECKPOINT_PROMPT, LONG_TRIPLES, longLegs, longUnits, tripleTasks } from './long.mjs'
import { readTasks } from './plan.mjs'

/**
 * The long-session shape of `pnpm bench:tokens` (T197).
 *
 * Everything here is about one failure: a long cell that is not actually one session working three
 * tickets with commands between them. T190 measured RTK where no command output happened and
 * published +26%; a `long` mode whose checkpoints do not run the suite and the diff, or whose legs
 * are three separate sessions, would publish a second number just as unearned.
 */

const tasks = readTasks()

describe('the long triple', () => {
  it('names three tickets that exist, in order', () => {
    for (const triple of LONG_TRIPLES) {
      expect(triple.tasks.length).toBe(3)
      expect(tripleTasks(triple, tasks).map((task) => task.id)).toEqual([...triple.tasks])
    }
  })

  it('says which ticket is missing rather than planning a cell with a hole in it', () => {
    expect(() => tripleTasks({ ...LONG_TRIPLES[0], tasks: ['nope'] }, tasks)).toThrow(/nope/)
  })

  it('is one triple for now, and every cell of a run works the same three tickets', () => {
    expect(LONG_TRIPLES.length).toBe(1)
  })
})

describe('the legs of a long cell', () => {
  const [triple] = LONG_TRIPLES
  const legs = longLegs(triple, tasks)

  it('alternates ticket and checkpoint, a checkpoint after every ticket including the last', () => {
    expect(legs.map((leg) => leg.kind)).toEqual([
      'ticket',
      'checkpoint',
      'ticket',
      'checkpoint',
      'ticket',
      'checkpoint',
    ])
    expect(legs.map((leg) => leg.id)).toEqual(['t1', 'c1', 't2', 'c2', 't3', 'c3'])
  })

  it('gives every ticket leg the ticket’s own words, unchanged from the file the solo mode reads', () => {
    for (const leg of legs.filter((one) => one.kind === 'ticket')) {
      expect(leg.prompt).toBe(tasks.find((task) => task.id === leg.task)?.prompt)
    }
  })

  it('names the ticket each leg belongs to, so the report can read a checkpoint next to its ticket', () => {
    expect(legs.map((leg) => leg.task)).toEqual([...triple.tasks].flatMap((id) => [id, id]))
  })

  it('makes every checkpoint the same words, so three checkpoints are three measurements of one thing', () => {
    const checkpoints = legs.filter((leg) => leg.kind === 'checkpoint')
    expect(new Set(checkpoints.map((leg) => leg.prompt)).size).toBe(1)
  })
})

describe('the checkpoint', () => {
  it('runs the whole suite, the whole diff and the log — the command output RTK exists to filter', () => {
    expect(CHECKPOINT_PROMPT).toContain('npx vitest run')
    expect(CHECKPOINT_PROMPT).toContain('git --no-pager diff')
    expect(CHECKPOINT_PROMPT).toContain('git --no-pager log')
  })

  it('never asks for a pager, which in a headless session waits for a key nobody presses', () => {
    for (const command of CHECKPOINT_PROMPT.matchAll(/`git ([^`]*)`/g)) {
      expect(command[1], `${command[0]} would open a pager`).toContain('--no-pager')
    }
  })

  it('asks for the whole diff and not a --stat, because four lines are not worth filtering', () => {
    expect(CHECKPOINT_PROMPT).not.toContain('diff --stat')
  })
})

describe('a long unit', () => {
  it('is shaped like a ticket, so the plan, the cell ids and the report treat it as one', () => {
    const [unit] = longUnits(tasks)
    if (!unit) throw new Error('a long run planned no units')
    expect(unit.id).toBe(LONG_TRIPLES[0].id)
    expect(typeof unit.size).toBe('string')
    expect(unit.trap).toBe('none')
    expect(unit.prompt).toBe(unit.legs?.[0]?.prompt)
    expect(unit.legs?.length).toBe(6)
  })
})
