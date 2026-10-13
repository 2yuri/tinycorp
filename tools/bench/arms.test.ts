import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Arm } from './arms.mjs'
import {
  ARMS,
  armIds,
  armOf,
  armSettings,
  armSystemPrompt,
  armsOfMode,
  armText,
  DM_SERVER,
  rtkHookCommand,
  SHARED_RULES,
} from './arms.mjs'

/**
 * The arms of `pnpm bench:tokens` (T190).
 *
 * Every test here is about one failure: an arm that is not the thing it claims to be. That is how
 * a benchmark lies without anyone noticing — the baseline quietly carrying the treatment, two arms
 * differing by more than the one variable, or the terse-voice arm measuring a paraphrase of a
 * voice this repo no longer ships.
 */

const REPO = join(import.meta.dirname, '..', '..')

/** The arm by id. A miss fails here, with the id in it, rather than as a null five lines later. */
function armNamed(id: string): Arm {
  const one = armOf(id)
  if (!one) throw new Error(`no arm ${id}`)
  return one
}

describe('the arms', () => {
  it('differ from baseline by exactly their own text and nothing else', () => {
    const baseline = armSystemPrompt(armNamed('baseline'))
    expect(baseline).toBe(SHARED_RULES)
    for (const arm of ARMS) {
      const prompt = armSystemPrompt(arm)
      expect(prompt, `${arm.id} dropped the rules every arm shares`).toContain(SHARED_RULES)
      const own = prompt.slice(0, prompt.length - SHARED_RULES.length).trim()
      const text = armText(arm)
      expect(own, `${arm.id} appends something that is not its own text`).toBe(text ? text.trim() : '')
    }
  })

  it('never carries another arm’s text, which is what makes a difference a difference', () => {
    for (const arm of ARMS) {
      const prompt = armSystemPrompt(arm)
      const ours = armText(arm)
      for (const other of ARMS) {
        const text = armText(other)
        if (!text || other.id === arm.id) continue
        // Where one arm's text is inside another's on purpose — `rtk+ponytail` is `ponytail` plus a
        // hook, `dm-terse` is `dm-plain` plus a section — finding it proves nothing either way.
        if (ours?.includes(text)) continue
        expect(prompt, `${arm.id} is carrying ${other.id}'s text`).not.toContain(text)
      }
    }
  })

  it('belongs to a shape of run, and every shape has an arm everything else is a percentage of', () => {
    for (const arm of ARMS) expect(arm.modes.length, `${arm.id} belongs to no mode`).toBeGreaterThan(0)
    expect(armsOfMode('solo').map((arm) => arm.id)[0]).toBe('baseline')
    expect(armsOfMode('long').map((arm) => arm.id)).toEqual(['baseline', 'rtk'])
    expect(armsOfMode('duo').map((arm) => arm.id)).toEqual(['dm-plain', 'dm-terse'])
    expect(armsOfMode('boss').map((arm) => arm.id)).toEqual(['boss-plain', 'caveman'])
    expect(armsOfMode('nope')).toEqual([])
  })

  it('declares an MCP server only where there is one, and only the app’s own name', () => {
    for (const arm of ARMS) {
      const chats = arm.modes.includes('duo') || arm.modes.includes('boss')
      expect(arm.mcp, `${arm.id} declares an MCP server it has no use for`).toEqual(chats ? [DM_SERVER] : [])
    }
  })

  it('declares every hook it writes, and writes no hook it does not declare', () => {
    for (const arm of ARMS) {
      const settings = armSettings(arm, { rtkPath: '/usr/local/bin/rtk' })
      if (!arm.rtk) {
        expect(settings, `${arm.id} writes a settings file it does not need`).toBeNull()
        expect(arm.declares, `${arm.id} declares a hook and writes none`).toEqual([])
        continue
      }
      if (!settings) throw new Error(`${arm.id} hooks RTK and wrote no settings file`)
      expect(Object.keys(settings.hooks)).toEqual(['PreToolUse'])
      expect(settings.hooks.PreToolUse[0]?.matcher).toBe('Bash')
      expect(arm.declares).toEqual(['PreToolUse:Bash'])
    }
  })

  it('refuses to build an RTK arm without an RTK, rather than writing a hook that runs nothing', () => {
    expect(() => armSettings(armNamed('rtk'), { rtkPath: null })).toThrow(/rtk/)
  })

  it('has a unique id per arm, and baseline first because every % is a % of it', () => {
    expect(armIds()[0]).toBe('baseline')
    expect(new Set(armIds()).size).toBe(ARMS.length)
    expect(armOf('nope')).toBeNull()
  })
})

describe('the terse-voice arm', () => {
  /**
   * The bench must measure the voice this repo actually ships, and the two are in different files:
   * `TERSE_RULES` in `src/main/features/sessions/instructions.ts` is what an Employee is told, and
   * `tools/bench/arms/terse-voice.md` is what the arm prepends. Nothing but this test stops the
   * first from being edited and the results file going on quoting a percentage for the old words.
   *
   * The source is a TypeScript array whose long lines are split with `+`, so the comparison joins
   * those back together and resolves the `\uXXXX` escapes it writes arrows and dashes as.
   */
  it('is word for word the Between Employees section the app sends (T180)', () => {
    const arm = readFileSync(join(import.meta.dirname, 'arms', 'terse-voice.md'), 'utf8')
    const source = readFileSync(join(REPO, 'src', 'main', 'features', 'sessions', 'instructions.ts'), 'utf8')
    const joined = source
      .replace(/'\s*\+\s*\n\s*'/g, '')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    const lines = arm.split('\n').filter((line) => line.trim())
    expect(lines.length).toBeGreaterThan(5)
    for (const line of lines) {
      expect(joined, `the bench prepends a line instructions.ts no longer says: ${line}`).toContain(line)
    }
  })
})

describe('the two DM arms', () => {
  /**
   * The pair the DM round compares, and the whole claim it makes: `dm-terse` is `dm-plain` and the
   * Between Employees section, which is exactly what the Company toggle adds (T180). If it were
   * anything else — a paraphrase, a reordering, an extra sentence of encouragement — the percentage
   * the results file prints would belong to words the app does not send.
   */
  it('differ by exactly the Between Employees section, which is what the toggle does', () => {
    const plain = armText(armNamed('dm-plain'))
    const terse = armText(armNamed('dm-terse'))
    const section = readFileSync(join(import.meta.dirname, 'arms', 'terse-voice.md'), 'utf8').trim()
    if (!plain || !terse) throw new Error('a DM arm has no text')
    expect(terse.startsWith(plain)).toBe(true)
    expect(terse.slice(plain.length).trim()).toBe(section)
  })

  it('both carry How you write, because the app sends it whatever the toggle says', () => {
    const humanizer = readFileSync(join(import.meta.dirname, 'arms', 'plain-voice.md'), 'utf8').trim()
    for (const id of ['dm-plain', 'dm-terse']) {
      expect(armSystemPrompt(armNamed(id))).toContain(humanizer)
    }
  })

  it('each say which voice they are, so a wake prompt names it rather than guessing from an id', () => {
    expect(armNamed('dm-plain').voice).toBe('plain')
    expect(armNamed('dm-terse').voice).toBe('terse')
    expect(armNamed('baseline').voice).toBeNull()
  })

  it('is word for word the How you write section the app sends (T180)', () => {
    const arm = readFileSync(join(import.meta.dirname, 'arms', 'plain-voice.md'), 'utf8')
    const source = readFileSync(join(REPO, 'src', 'main', 'features', 'sessions', 'instructions.ts'), 'utf8')
    const joined = source
      .replace(/'\s*\+\s*\n?\s*'/g, '')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    const lines = arm.split('\n').filter((line) => line.trim())
    expect(lines.length).toBeGreaterThan(10)
    for (const line of lines) {
      expect(joined, `the bench prepends a line instructions.ts no longer says: ${line}`).toContain(line)
    }
  })
})

describe('the ponytail arms', () => {
  it('prepend the vendored SKILL.md, with its licence beside it', () => {
    const skill = readFileSync(join(import.meta.dirname, 'vendor', 'ponytail', 'SKILL.md'), 'utf8')
    const licence = readFileSync(join(import.meta.dirname, 'vendor', 'ponytail', 'LICENSE'), 'utf8')
    expect(licence).toContain('MIT License')
    expect(licence).toContain('DietrichGebert')
    for (const id of ['ponytail', 'rtk+ponytail']) {
      expect(armSystemPrompt(armNamed(id))).toContain(skill.trim())
    }
  })

  it('differ from each other by the RTK hook alone', () => {
    expect(armSystemPrompt(armNamed('rtk+ponytail'))).toBe(armSystemPrompt(armNamed('ponytail')))
    expect(armNamed('rtk+ponytail').rtk).toBe(true)
    expect(armNamed('ponytail').rtk).toBe(false)
  })
})

describe('the RTK hook command', () => {
  it('quotes the path on every platform, because Program Files has a space in it', () => {
    expect(rtkHookCommand('C:\\Program Files\\rtk\\rtk.exe', 'win32')).toBe(
      "& 'C:\\Program Files\\rtk\\rtk.exe' hook claude",
    )
    expect(rtkHookCommand('/opt/homebrew/bin/rtk', 'darwin')).toBe("'/opt/homebrew/bin/rtk' hook claude")
    expect(rtkHookCommand("/home/o'brien/rtk", 'linux')).toBe("'/home/o'\\''brien/rtk' hook claude")
  })
})

describe('the rules every arm shares', () => {
  it('spells out `vitest run`, because bare `vitest` watches and the cell then times out', () => {
    expect(SHARED_RULES).toContain('npx vitest run')
    expect(SHARED_RULES).toContain('never bare `npx vitest`')
  })

  it('tells every arm not to install, since one node_modules is shared by every workspace', () => {
    expect(SHARED_RULES).toMatch(/do not install/i)
  })
})
