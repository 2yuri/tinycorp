import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  COMPARE_FLOOR,
  coverage,
  coverageLines,
  HARNESSES,
  movedLines,
  movedSheetHtml,
  pathOf,
  runs,
  STATES,
  stylesheets,
  urlOf,
  withImports,
} from '../tools/design-baseline.mjs'
import { shooterArgs, shooterSource } from '../tools/design-shooter.mjs'

/**
 * `pnpm design:baseline` and `pnpm design:compare`: a picture of every screen as the app draws it
 * today, and the same picture again.
 *
 * What a test cannot check here is the pixels — that is what the PNGs are for. What it can check
 * is the two things that would make the whole tool lie. A table that names a harness or a page
 * this repo does not serve shoots a blank and passes for ever; and two harnesses served at once on
 * one port has one of them answering for the other, which is how the Files capture came back
 * looking like an empty worktree, drawn by the drawer's server, with nothing said (T209).
 */

const REPO = join(import.meta.dirname, '..')

describe('the baseline table', () => {
  it('names harnesses this repo really serves, on the port their config pins', () => {
    for (const [name, harness] of Object.entries(HARNESSES)) {
      expect(existsSync(join(REPO, harness.config)), `${name}: ${harness.config}`).toBe(true)
      const config = readFileSync(join(REPO, harness.config), 'utf8')
      expect(config, `${name} is pinned to a port the baseline does not use`).toContain(`port: ${harness.port}`)
    }
  })

  /** Every capture harness, not the four the audit has a frame for: a screen nobody shoots is unwatched. */
  it('covers every capture harness in the repo', () => {
    const configs = new Set(Object.values(HARNESSES).map((harness) => harness.config))
    for (const config of captureConfigs()) expect(configs, config).toContain(config)
  })

  it('shoots pages the harnesses have, from harnesses it declared', () => {
    for (const one of STATES) {
      expect(Object.keys(HARNESSES), one.id).toContain(one.harness)
      expect(existsSync(join(REPO, 'src', 'renderer', one.page)), one.id).toBe(true)
      expect(urlOf(one)).toContain(`127.0.0.1:${HARNESSES[one.harness]!.port}`)
    }
  })

  it('has an id for every state, and names each one once', () => {
    const ids = STATES.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shoots every state in a window of its own size', () => {
    for (const one of STATES) {
      expect(one.width, one.id).toBeGreaterThan(0)
      expect(one.height, one.id).toBeGreaterThan(0)
    }
  })

  it('puts each state’s PNG under its harness, as a POSIX path', () => {
    for (const one of STATES) {
      expect(pathOf(one)).toBe(posix.join('design/baseline', one.harness, `${one.id}.png`))
      expect(pathOf(one)).not.toContain('\\')
    }
  })
})

describe('the order a run serves in', () => {
  it('serves one harness at a time, so two can never answer on one port', () => {
    for (const run of runs(STATES)) expect(typeof run.harness).toBe('string')
    const served = runs(STATES).map((run) => run.harness)
    expect(new Set(served).size).toBe(served.length)
  })

  it('shoots every state exactly once, across all the runs', () => {
    const shot = runs(STATES).flatMap((run) => run.states.map((one) => one.id))
    expect(shot.sort()).toEqual(STATES.map((one) => one.id).sort())
  })

  /** Three configs pin 5188 and five more ports are shared by two; each gets a turn of its own. */
  it('gives each of the harnesses that share a port its own turn', () => {
    const shared = ['drawer', 'drawer-memory', 'files']

    expect(runs(STATES.filter((one) => shared.includes(one.harness)))).toHaveLength(3)
  })
})

describe('the coverage table', () => {
  /** The whole point of the wider table: a stylesheet no state draws is one nothing watches. */
  it('says which stylesheets a run drew and which it did not', () => {
    const rows = coverage({ 'one-state': ['src/renderer/src/board/board.css'] }, [
      'src/renderer/src/board/board.css',
      'src/renderer/src/board/new-ticket.css',
      'src/renderer/src/usage/usage.css',
    ])

    expect(rows).toEqual([
      {
        folder: 'src/renderer/src/board',
        sheets: ['src/renderer/src/board/board.css', 'src/renderer/src/board/new-ticket.css'],
        states: ['one-state'],
        uncovered: ['src/renderer/src/board/new-ticket.css'],
      },
      {
        folder: 'src/renderer/src/usage',
        sheets: ['src/renderer/src/usage/usage.css'],
        states: [],
        uncovered: ['src/renderer/src/usage/usage.css'],
      },
    ])
  })

  it('prints a line per folder, and names the sheets nothing drew', () => {
    const lines = coverageLines(
      coverage({ one: ['src/renderer/src/board/board.css'] }, [
        'src/renderer/src/board/board.css',
        'src/renderer/src/usage/usage.css',
      ]),
    )

    expect(lines[0]).toContain('ok  ')
    expect(lines[0]).toContain('drawn by 1 state')
    expect(lines[1]).toContain('NONE')
    expect(lines[1]).toContain('usage.css')
  })

  /**
   * `tokens.css` is drawn on every screen and loaded by none: vite folds a relative `@import` into
   * the importing sheet, so the page can only ever name `base.css`.
   */
  it('counts a sheet a drawn one @imports as drawn too', () => {
    const found = withImports(['src/renderer/src/ui/tailwind.css'])

    expect(found).toContain('src/renderer/src/ui/tokens.css')
  })

  it('reads every stylesheet the renderer has', () => {
    const sheets = stylesheets()

    // No count: the Tailwind migration is deleting these, and a number here would be a test that
    // fails for the good news. What has to hold is that the scan finds the ones that are there.
    expect(sheets.length).toBeGreaterThan(0)
    expect(sheets).toContain('src/renderer/src/ui/tokens.css')
    expect(sheets).toContain('src/renderer/src/ui/tailwind.css')
    expect(sheets.every((sheet) => sheet.endsWith('.css'))).toBe(true)
    // Sorted and POSIX, so the printed table reads the same on the Windows runner.
    expect(sheets).toEqual([...sheets].sort())
    expect(sheets.some((sheet) => sheet.includes('\\'))).toBe(false)
  })
})

describe('what a compare run says', () => {
  it('marks a state over the floor as moved, and one with no baseline as missing', () => {
    const lines = movedLines([
      { id: 'settings-office', score: COMPARE_FLOOR + 0.2, baseline: 'design/baseline/settings/settings-office.png' },
      { id: 'memory', score: 0, baseline: 'design/baseline/memory/memory.png' },
      { id: 'new-screen', score: null, baseline: 'design/baseline/new/new-screen.png' },
    ])

    // A state with no baseline leads: it is the one failure a score cannot rank.
    expect(lines[0]).toContain('MISSING  new-screen')
    expect(lines[1]).toContain('MOVED  settings-office')
    expect(lines[2]).toContain('ok     memory')
  })

  /** Worst first: a sheet read from the top is a sheet whose first row is the one to look at. */
  it('puts the state that moved most at the top', () => {
    const lines = movedLines([
      { id: 'small', score: 0.4, baseline: '' },
      { id: 'big', score: 9, baseline: '' },
    ])

    expect(lines[0]).toContain('big')
  })

  it('draws a cell per moved state, with the two shots and the blend between them', () => {
    const html = movedSheetHtml([
      {
        id: 'settings-office',
        width: 1512,
        height: 944,
        score: 4.2,
        baselineSrc: 'file:///baseline.png',
        nowSrc: 'file:///now.png',
      },
    ])

    expect(html).toContain('settings-office')
    expect(html).toContain('>4.20%<')
    expect(html).toContain('mix-blend-mode: difference')
    expect(html).toContain('file:///baseline.png')
    expect(html).toContain('file:///now.png')
  })
})

describe('the script the shooter runs', () => {
  // It is written out as text and started by Electron, so nothing compiles it before a run does. A
  // slip in an escape inside the template is a main-process error dialog on the boss's screen and a
  // run that waits for it forever.
  it('is JavaScript Electron can load', () => {
    expect(() => new Script(shooterSource())).not.toThrow()
  })
})

describe('the command line the shooter is started with', () => {
  /**
   * The bug this is here for: macOS's *Show scroll bars* is `Automatic`, which means *is a mouse
   * plugged in*, and Chromium draws a 15px scrollbar gutter with one and none without. 44 of 114
   * states moved between two runs of the same commit for it, and nothing in the repo had changed
   * (T254). The pin is in the shooter's own command line, so the boss's setting is left alone.
   */
  it('pins macOS’s scrollbar style for its own process', () => {
    const args = shooterArgs('/scratch/shooter.cjs', '/scratch/profile', { jobs: [] }, 'darwin')

    expect(args.join(' ')).toContain('-AppleShowScrollBars Always')
  })

  it('pins nothing on Windows or Linux, where no per-user setting decides it', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const args = shooterArgs('/scratch/shooter.cjs', '/scratch/profile', { jobs: [] }, platform)

      expect(args.join(' '), platform).not.toContain('AppleShowScrollBars')
    }
  })

  /** The shooter reads its jobs off the end of the line; anything appended after them blinds it. */
  it('hands the jobs over last, on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const args = shooterArgs('/scratch/shooter.cjs', '/scratch/profile', { jobs: [{ out: 'a.png' }] }, platform)

      expect(JSON.parse(args.at(-1) as string), platform).toEqual({ jobs: [{ out: 'a.png' }] })
      expect(args[0], platform).toBe('/scratch/shooter.cjs')
      expect(args, platform).toContain('--user-data-dir=/scratch/profile')
    }
  })
})

/** Every capture harness's vite config under the renderer, repo-relative and POSIX. */
function captureConfigs(): string[] {
  const found: string[] = []
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === 'vite.config.mts')
        found.push(
          path
            .slice(REPO.length + 1)
            .split(sep)
            .join('/'),
        )
    }
  }
  walk(join(REPO, 'src', 'renderer'))
  return found.sort()
}
