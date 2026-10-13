import type { MemoryContradiction, MemoryKind } from '../../../shared/memory/company-memory'

/**
 * The contradiction heuristic (T175), which is terms and nothing else. No model reads a page: two
 * pages are flagged when they are the same kind, share a repo, and write the same key with two
 * different values — the config key with two settings, the constant with two numbers.
 *
 * It finds what it finds. It is deliberately narrow: a wrong flag costs the boss a click, and the
 * banner says in as many words that a term found it, so nobody reads it as a judgement.
 */

/** One `key = value` a page states. */
export interface Claim {
  /** As written, for the banner. */
  key: string
  value: string
}

/** A page as the heuristic needs it. */
export interface TermPage {
  slug: string
  title: string
  kind: MemoryKind
  repos: string[]
  body: string
}

/**
 * The keys a page states a value for. Three shapes, all of them things people write in a wiki:
 *
 * - `DEFAULT_CURRENCY=EUR`, with or without backticks;
 * - a bullet or line that starts `DEFAULT_CURRENCY: EUR`;
 * - `` `DEFAULT_CURRENCY` is EUR ``.
 *
 * A key has to look like a key — at least four characters, and either `_`, `.`, `-` in it or all
 * caps — so ordinary prose with a colon in it states nothing.
 */
export function claimsIn(body: string): Claim[] {
  const claims = new Map<string, Claim>()
  const add = (key: string, value: string) => {
    const clean = cleanValue(value)
    if (!isKey(key) || clean === '') return
    // The first statement of a key on a page is the one it is held to; a page that says it twice
    // is contradicting itself, which is not what this is for.
    if (!claims.has(key.toLowerCase())) claims.set(key.toLowerCase(), { key, value: clean })
  }
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    for (const match of line.matchAll(/`?([A-Za-z_][A-Za-z0-9_.-]*)`?\s*=\s*([^\s,;)]+)/g)) {
      add(match[1]!, match[2]!)
    }
    const labelled = /^\s*(?:[-*]\s+)?`?([A-Za-z_][A-Za-z0-9_.-]*)`?\s*:\s+(.+)$/.exec(line)
    if (labelled) add(labelled[1]!, labelled[2]!)
    for (const match of line.matchAll(/`([A-Za-z_][A-Za-z0-9_.-]*)`\s+is\s+`?([^\s,.;`]+)`?/g)) {
      add(match[1]!, match[2]!)
    }
  }
  return [...claims.values()]
}

/** A token is a key when it is long enough and is written the way keys are. */
function isKey(key: string): boolean {
  if (key.length < 4) return false
  if (/[_.-]/.test(key)) return true
  return key === key.toUpperCase()
}

/** Strips the punctuation a sentence leaves on a value, and the quotes or backticks around it. */
function cleanValue(value: string): string {
  let clean = value.trim()
  let previous = ''
  // A value is written `EUR`, or `EUR`. at the end of a sentence, so the quotes and the full stop
  // come off in whichever order they were put on.
  while (clean !== previous) {
    previous = clean
    clean = clean
      .replace(/^[`'"]+/, '')
      .replace(/[`'"]+$/, '')
      .replace(/[.,;:]+$/, '')
      .trim()
  }
  return clean
}

/**
 * Every pair of pages the heuristic disagrees on, as a map from slug to the contradiction its own
 * banner shows. A page in more than one pair keeps the first, so the banner names one page.
 */
export function findContradictions(pages: readonly TermPage[]): Map<string, MemoryContradiction> {
  const claims = new Map(pages.map((page) => [page.slug, claimsIn(page.body)]))
  const found = new Map<string, MemoryContradiction>()
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i]!
      const b = pages[j]!
      if (a.kind !== b.kind) continue
      if (!a.repos.some((repo) => b.repos.includes(repo))) continue
      const clash = clashBetween(claims.get(a.slug) ?? [], claims.get(b.slug) ?? [])
      if (!clash) continue
      if (!found.has(a.slug)) {
        found.set(a.slug, { slug: b.slug, title: b.title, term: clash.key, values: [clash.a, clash.b] })
      }
      if (!found.has(b.slug)) {
        found.set(b.slug, { slug: a.slug, title: a.title, term: clash.key, values: [clash.b, clash.a] })
      }
    }
  }
  return found
}

function clashBetween(a: readonly Claim[], b: readonly Claim[]): { key: string; a: string; b: string } | null {
  for (const left of a) {
    const right = b.find((claim) => claim.key.toLowerCase() === left.key.toLowerCase())
    if (!right) continue
    if (right.value.toLowerCase() === left.value.toLowerCase()) continue
    return { key: left.key, a: left.value, b: right.value }
  }
  return null
}
