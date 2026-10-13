import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The strictness `tsconfig.base.json` promises, pinned.
 *
 * `pnpm typecheck` cannot catch a flag being turned off — turning one off is what makes the errors
 * go away. Each of these was turned on by a ticket that then fixed every error it found, and the
 * cheapest way to undo that work is a one-word edit in a config nobody reads twice. So the list is
 * here, and a pull request that shortens it has to say so out loud (T183, T184, T191).
 */
const ALWAYS_ON = [
  'strict',
  'noUncheckedIndexedAccess',
  'noImplicitOverride',
  'noFallthroughCasesInSwitch',
  'verbatimModuleSyntax',
  'noUnusedLocals',
  'noUnusedParameters',
  'noPropertyAccessFromIndexSignature',
  'exactOptionalPropertyTypes',
] as const

/** `tsconfig.base.json` is JSONC: every comment in it is a reason, and none of them is a string. */
function readBaseOptions(): Record<string, unknown> {
  const text = readFileSync(join(import.meta.dirname, '..', 'tsconfig.base.json'), 'utf8')
  const parsed = JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as { compilerOptions?: Record<string, unknown> }
  return parsed.compilerOptions ?? {}
}

describe('What both TypeScript projects are compiled with', () => {
  it('keeps every strictness flag on', () => {
    const options = readBaseOptions()

    expect(ALWAYS_ON.filter((flag) => options[flag] !== true)).toEqual([])
  })
})
