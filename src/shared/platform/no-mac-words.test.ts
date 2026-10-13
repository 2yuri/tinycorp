import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No screen says *this Mac* on a PC (T265).
 *
 * The screens were drawn on a Mac, and the Windows build said *Add a repository from anywhere on
 * this Mac*. A Mac word — `this Mac`, `Finder`, `keychain`, a spelt-out `Cmd` — is written in
 * `machine-words.ts` and nowhere else under `src/renderer` or `src/shared`; a sentence reads it
 * from there with the platform it is on. Comments are prose about the code and are left alone, and
 * so are tests and the capture harnesses, which pin one concrete Mac on purpose.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..')

const MAC_WORDS: readonly RegExp[] = [/this Mac\b/, /\bFinder\b/, /\bkeychain\b/i, /\bCmd\b/]

/** Where a Mac word is right, and why. */
const ALLOWED: readonly { file: string; why: string }[] = [
  { file: 'src/shared/platform/machine-words.ts', why: 'the one module of the machine’s words' },
  {
    file: 'src/shared/review/security.ts',
    why: 'a path fragment a security review matches on, never a word the boss reads',
  },
]

describe('The renderer and shared', () => {
  it('write no Mac word outside machine-words.ts: every one comes from the platform', () => {
    const offenders = sources().flatMap(([file, text]) =>
      code(text).flatMap((line, index) =>
        MAC_WORDS.some((word) => word.test(line)) ? [`${file}:${index + 1} — ${line.trim()}`] : [],
      ),
    )

    expect(
      offenders,
      'a Mac word on a PC tells the boss they are on a machine they are not on. Read it from `machineWords(platform)` in `shared/platform/machine-words.ts`',
    ).toEqual([])
  })

  it('has something to look through, so the check cannot pass by finding nothing', () => {
    expect(sources().length).toBeGreaterThan(100)
  })

  it('reads through comments and nothing else', () => {
    expect(code('const a = 1 // on this Mac\n/* the keychain\n Finder */ const b = "this Mac"')).toEqual([
      'const a = 1',
      '',
      ' const b = "this Mac"',
    ])
    expect(code("const url = 'https://this Mac'")).toEqual(["const url = 'https://this Mac'"])
  })
})

/**
 * `text` with its comments blanked, line for line, so a line number still points at the source. A
 * `//` counts as a comment only after whitespace or at the start, so `https://` stays code.
 */
function code(text: string): string[] {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
  return blanked.split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
}

function sources(): [string, string][] {
  return [...walk(join(ROOT, 'src', 'renderer'), 'src/renderer'), ...walk(join(ROOT, 'src', 'shared'), 'src/shared')]
    .filter(([file]) => !/\.test\.tsx?$/.test(file) && !file.includes('/capture/'))
    .filter(([file]) => !ALLOWED.some((entry) => entry.file === file))
}

function walk(root: string, prefix: string): [string, string][] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    const shown = `${prefix}/${name}`
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, shown)
    if (!/\.tsx?$/.test(name)) return []
    return [[shown, readFileSync(path, 'utf8')] as [string, string]]
  })
}
