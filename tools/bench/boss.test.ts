import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cavemanRules } from '../../src/shared/caveman'
import { armOf, armSystemPrompt, armsOfMode, armText, DM_SERVER } from './arms.mjs'
import {
  answersRight,
  BOSS_NAME,
  bossRolePrompt,
  bossUnits,
  bossWakePrompt,
  EMPLOYEE_NAME,
  nextAsk,
  QUESTIONS,
} from './boss.mjs'
import { dmRecord } from './dm.mjs'
import { VOICE_HINT } from './duo.mjs'
import { chosenArms, MODES, planCells, readTasks } from './plan.mjs'

/**
 * The boss shape of `pnpm bench:tokens` (T261).
 *
 * The tests that matter here are the faithfulness ones, as they are for `duo`: the arm is a claim
 * about a section this repo really sends, so the text it prepends has to be that section and the
 * voice clause in its wake prompts has to be the clause the app really sends. A paraphrase would
 * produce a percentage for words nothing ships, which is the same kind of lie as a contaminated
 * baseline.
 */

const tasks = readTasks()
const task = tasks.find((one) => one.id === 'edit-comment')
if (!task) throw new Error('the boss round needs the edit-comment ticket')

function armNamed(id: string) {
  const one = armOf(id)
  if (!one) throw new Error(`no arm ${id}`)
  return one
}

describe('the caveman arm', () => {
  /**
   * The whole claim the round makes: `caveman` is `boss-plain` and the How you answer the boss
   * section, which is exactly what the Company toggle adds. Anything else — a paraphrase, an extra
   * sentence of encouragement — and the number would belong to words the app does not send.
   */
  it('differs from boss-plain by exactly the section the toggle adds', () => {
    const plain = armText(armNamed('boss-plain'))
    const caveman = armText(armNamed('caveman'))
    const section = readFileSync(join(import.meta.dirname, 'arms', 'caveman.md'), 'utf8').trim()
    if (!plain || !caveman) throw new Error('a boss arm has no text')

    expect(caveman.startsWith(plain)).toBe(true)
    expect(caveman.slice(plain.length).trim()).toBe(section)
    expect(armNamed('caveman').builtOn).toBe('boss-plain')
  })

  it('is word for word the section an Employee is handed at Full (T261)', () => {
    const arm = readFileSync(join(import.meta.dirname, 'arms', 'caveman.md'), 'utf8').trim()

    expect(arm).toBe(cavemanRules('full').join('\n').trim())
  })

  it('both arms carry How you write, because the app sends it whatever the toggle says', () => {
    const humanizer = readFileSync(join(import.meta.dirname, 'arms', 'plain-voice.md'), 'utf8').trim()
    for (const id of ['boss-plain', 'caveman']) expect(armSystemPrompt(armNamed(id))).toContain(humanizer)
  })

  it('is the boss round’s two arms, with the one the other is a percentage of first', () => {
    expect(armsOfMode('boss').map((one) => one.id)).toEqual(['boss-plain', 'caveman'])
    for (const one of armsOfMode('boss')) expect(one.mcp).toEqual([DM_SERVER])
  })

  it('belongs to the boss round only, because a duo cell has no boss in it', () => {
    expect(armNamed('caveman').modes).toEqual(['boss'])
    expect(() => chosenArms(['caveman'], MODES.duo)).toThrow(/not one of mode duo/)
    expect(() => chosenArms(['dm-terse'], MODES.boss)).toThrow(/not one of mode boss/)
  })
})

describe('the boss round’s plan', () => {
  it('lists one cell per ticket, arm and repeat, which is what --dry-run prints', () => {
    const cells = planCells({ tasks: bossUnits(tasks), arms: armsOfMode('boss'), n: 3 })

    expect(cells).toHaveLength(6)
    expect(cells.map((one) => one.id)).toEqual([
      'edit-comment__boss-plain__1',
      'edit-comment__caveman__1',
      'edit-comment__boss-plain__2',
      'edit-comment__caveman__2',
      'edit-comment__boss-plain__3',
      'edit-comment__caveman__3',
    ])
  })

  it('refuses a ticket the bench does not have, rather than running a cell about nothing', () => {
    expect(() => bossUnits(tasks, ['no-such-ticket'])).toThrow(/no task no-such-ticket/)
  })
})

/**
 * The plan the boss reads is the object the run then executes (`plan.mjs`), so `--dry-run` is
 * worth having only if it really prints it. This starts the command as a real process, because
 * everything between `parseArgs` and the printed table — the mode lookup, the arm filter, the unit
 * list, the estimate — is wiring that a unit test of `planCells` would not touch, and a `--mode
 * boss` that throws on startup is a broken mode nobody would find until they spent money on it.
 */
describe('`pnpm bench:tokens --mode boss --dry-run`', () => {
  const dryRun = () =>
    spawnSync(process.execPath, [join(import.meta.dirname, 'bench-tokens.mjs'), '--mode', 'boss', '--dry-run'], {
      encoding: 'utf8',
      // The bench refuses outright when a key is set, dry run or not; this test is about the plan.
      env: { ...process.env, ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' },
    })

  it('lists the cells, the arms and what a real run would spend, and spends nothing', () => {
    const out = dryRun()

    expect(out.status).toBe(0)
    expect(out.stdout).toContain('mode      boss')
    expect(out.stdout).toContain('arms      boss-plain, caveman')
    expect(out.stdout).toContain('ticket    edit-comment')
    expect(out.stdout).toMatch(/cells {5}6 \(1 × 2 × n=3\)/)
    expect(out.stdout).toMatch(/estimate {2}~[\d.]+M tokens, ~\$[\d.]+ of subscription usage/)
    expect(out.stdout).toContain('Dry run: nothing was spent. Add --yes to run it.')
  })

  it('says what each arm is, so the plan names the thing being measured', () => {
    const out = dryRun()

    expect(out.stdout).toContain('One Employee reporting to the boss, with How you write alone')
    expect(out.stdout).toContain('what the add-on does (T261)')
  })
})

describe('the wake prompt a boss message arrives in', () => {
  const message = { id: 4, text: 'Which files are you changing? Give me the paths.' }

  it('is the app’s own inboxPrompt shape for a DM from the boss', () => {
    const prompt = bossWakePrompt(message)

    expect(prompt.startsWith(`[company] DM from ${BOSS_NAME} in @${BOSS_NAME}: `)).toBe(true)
    expect(prompt).toContain(JSON.stringify(message.text))
    expect(prompt).toContain('(message 4)')
    expect(prompt).toContain(`chat_post to "@${BOSS_NAME}"`)
    expect(prompt).toContain('Never answer in plain text.')
  })

  /**
   * The clause the app really sends for anything the boss can read, and the one the add-on's own
   * section has to settle. Both arms get it, identically: it is not what they differ by.
   */
  it('carries voiceHint’s own boss clause, word for word and in both arms', () => {
    expect(bossWakePrompt(message)).toContain(VOICE_HINT.plain)
    expect(VOICE_HINT.plain).toBe('The boss can read this → plain words, full sentences.')
  })
})

describe('who the Employee is told it is', () => {
  it('names the two report-backs and nothing else, so both arms send the same number of messages', () => {
    const prompt = bossRolePrompt()

    expect(prompt).toContain(`You are ${EMPLOYEE_NAME}`)
    expect(prompt).toMatch(/1\. Before you write code, DM the boss/)
    expect(prompt).toMatch(/2\. When the change is ready, DM the boss/)
    expect(prompt).toContain('Answer every DM the boss sends you.')
  })
})

describe('which message the boss answers next', () => {
  const dm = (author: string, text: string, id: number) =>
    dmRecord({ id, author, channelId: 'dm', text, at: '2026-09-25T00:00:00.000Z' })

  it('is the Employee’s, never the boss’s own line back', () => {
    const thread = [dm(EMPLOYEE_NAME, 'starting', 1), dm(BOSS_NAME, 'which files?', 2), dm(EMPLOYEE_NAME, 'a.ts', 3)]

    expect(nextAsk(thread, 0)?.message.id).toBe(1)
    expect(nextAsk(thread, 1)?.message.id).toBe(3)
    expect(nextAsk(thread, 3)).toBeNull()
  })

  it('ignores a message that went somewhere nobody reads', () => {
    expect(nextAsk([{ ...dm(EMPLOYEE_NAME, 'hi', 1), channelId: 'general' }], 0)).toBeNull()
  })
})

describe('whether the answers still said it', () => {
  const question = (id: string) => QUESTIONS.find((one) => one.id === id)!

  it('checks the facts the add-on must never shorten: a path, a count, a yes or no', () => {
    expect(QUESTIONS.map((one) => one.id)).toEqual(['files', 'tests', 'blocked'])
    expect(question('files').wants.map((one) => one.what)).toEqual(['a file path'])
    expect(question('tests').wants.map((one) => one.what)).toEqual(['a number of tests', 'whether it passed'])
  })

  it('holds for a fragment that still carries the payload, which is the whole design', () => {
    const scored = answersRight([
      { question: question('files'), answer: 'src/features/comments/CommentItem.tsx + its test' },
      { question: question('tests'), answer: '142 pass' },
    ])

    expect(scored).toMatchObject({ asked: 2, checks: 3, held: 3, missing: [] })
  })

  it('fails an answer that dropped the fact, however short it is', () => {
    const scored = answersRight([{ question: question('files'), answer: 'changed comment component' }])

    expect(scored.held).toBe(0)
    expect(scored.missing).toEqual(['files: a file path'])
  })

  /** An arm may not score better by answering less: a question nobody replied to is wrong. */
  it('counts a question that drew no reply as wrong rather than as unasked', () => {
    const scored = answersRight([{ question: question('tests'), answer: null }])

    expect(scored).toMatchObject({ asked: 1, checks: 2, held: 0 })
    expect(scored.missing).toEqual(['tests: a number of tests', 'tests: whether it passed'])
  })

  it('says nothing about a question with nothing to check, rather than counting it right', () => {
    expect(answersRight([{ question: question('blocked'), answer: 'no' }])).toMatchObject({
      asked: 1,
      checks: 0,
      held: 0,
    })
  })
})
