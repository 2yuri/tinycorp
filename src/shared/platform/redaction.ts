/**
 * Swapping secret values out of anything an Employee, the boss or a log could read (T176).
 *
 * An Environment's values never enter an Employee's process: the app runs the command and hands
 * back what it printed. That is only true if the output cannot carry a value home, so everything
 * that comes back goes through here first, and `DATABASE_URL`'s value becomes `‹DATABASE_URL›`.
 *
 * Three things make that harder than a `replaceAll`:
 *
 * - a program prints a value in another shape — `base64` in an `Authorization` header, percent
 *   encoded in a URL — so every form of a value is matched, not only the one that was typed;
 * - output arrives in chunks, and a value can be cut in half by a pipe boundary, so a stream keeps
 *   back the tail that could still be the start of a value;
 * - a short value is a word. Redacting `dev` would blank out half the log and teach nobody
 *   anything, so a value shorter than {@link REDACTION_MIN_LENGTH} is stored but never matched:
 *   `PORT=3000` comes back in the output as it is. The boss chose that over refusing it.
 */

/** Below this, a value is indistinguishable from an ordinary word and is left unredacted. */
export const REDACTION_MIN_LENGTH = 6

/** What a redacted value reads as, as the frames draw it: `‹DATABASE_URL›`. */
export function redactedAs(name: string): string {
  return `‹${name}›`
}

/** One variable, as the redactor needs it: the name it is replaced by and the value to look for. */
export interface RedactableValue {
  name: string
  value: string
}

/**
 * Every shape one value could be printed in, longest first. Deduplicated: a value with no
 * character URL encoding touches yields the same string twice, and matching it twice is wasted work.
 */
export function valueForms(value: string): string[] {
  const forms = [value]
  const base64 = base64Of(value)
  if (base64) {
    forms.push(base64)
    forms.push(base64.replace(/=+$/, ''))
    forms.push(base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''))
  }
  try {
    forms.push(encodeURIComponent(value))
  } catch {
    // A lone surrogate cannot be URL encoded; the raw form still is.
  }
  const unique = [...new Set(forms)].filter((form) => form.length >= REDACTION_MIN_LENGTH)
  return unique.sort((a, b) => b.length - a.length)
}

function base64Of(value: string): string | null {
  try {
    // `btoa` is not available in the main process and `Buffer` is not in the renderer's lib types,
    // so the conversion is done by hand once, over the UTF-8 bytes.
    return base64OfBytes(new TextEncoder().encode(value))
  } catch {
    return null
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64OfBytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

/** One value found in text: where it is, and the name that takes its place. */
export interface RedactionMatch {
  start: number
  end: number
  name: string
}

/**
 * Redacts text, whole or a chunk at a time. The streaming side is the one that matters: a value
 * split across two chunks is exactly what a naive filter misses, and it is what a pipe does.
 */
export interface Redactor {
  /** The text with every value replaced. Independent of whatever the stream is holding. */
  redact(text: string): string
  /**
   * Takes the next chunk and returns what is safe to emit now: everything up to the last point
   * where a value could still be starting. Nothing partial ever leaves.
   */
  push(chunk: string): string
  /** The end of the stream: whatever was held back, redacted. */
  end(): string
  /** How many values have been swapped out, over everything this redactor has seen. */
  readonly count: number
}

/**
 * A redactor for these variables. A variable whose value is too short to tell apart from a word is
 * dropped rather than matched — see {@link REDACTION_MIN_LENGTH}.
 */
export function createRedactor(values: readonly RedactableValue[]): Redactor {
  /** Forms by their first character, so a scan compares against a handful rather than all of them. */
  const byFirst = new Map<string, { form: string; name: string }[]>()
  let longest = 0
  for (const { name, value } of values) {
    for (const form of valueForms(value)) {
      const first = form[0]!
      const bucket = byFirst.get(first) ?? []
      bucket.push({ form, name })
      byFirst.set(first, bucket)
      longest = Math.max(longest, form.length)
    }
  }
  // Longest first at every starting point, so a value that contains another is replaced whole.
  for (const bucket of byFirst.values()) bucket.sort((a, b) => b.form.length - a.form.length)

  function find(text: string): RedactionMatch[] {
    const found: RedactionMatch[] = []
    let i = 0
    while (i < text.length) {
      const bucket = byFirst.get(text[i]!)
      const hit = bucket?.find(({ form }) => text.startsWith(form, i))
      if (hit) {
        found.push({ start: i, end: i + hit.form.length, name: hit.name })
        i += hit.form.length
      } else {
        i += 1
      }
    }
    return found
  }

  function render(text: string, found: readonly RedactionMatch[]): string {
    let out = ''
    let at = 0
    for (const match of found) {
      out += text.slice(at, match.start) + redactedAs(match.name)
      at = match.end
    }
    return out + text.slice(at)
  }

  let held = ''
  let count = 0

  const redactor: Redactor = {
    redact(text) {
      const found = find(text)
      count += found.length
      return render(text, found)
    },

    push(chunk) {
      held += chunk
      if (longest === 0) {
        const out = held
        held = ''
        return out
      }
      const found = find(held)
      // Everything from here on could still be the first half of a value, so it waits for the
      // next chunk — and so does a match that already crosses the line.
      let cut = Math.max(0, held.length - (longest - 1))
      for (const match of found) {
        if (match.start < cut && match.end > cut) cut = match.start
      }
      const inside = found.filter((match) => match.end <= cut)
      count += inside.length
      const out = render(held.slice(0, cut), inside)
      held = held.slice(cut)
      return out
    },

    end() {
      const found = find(held)
      count += found.length
      const out = render(held, found)
      held = ''
      return out
    },

    get count() {
      return count
    },
  }
  return redactor
}
