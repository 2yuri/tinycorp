// The preload every `pnpm design:baseline` shot is taken through: one clock and one dice, so the
// same page is the same picture tomorrow (T209). CommonJS, because an Electron preload is.
//
// It runs before the page's own first script, which is the only moment early enough: a screen that
// reads `Date.now()` while its module loads has already read it by the time anything else could
// step in. The shooter turns context isolation off for exactly this window, so the page and this
// file share one `window`.

/**
 * The instant every baseline is taken at, in UTC — the shooter runs Electron with `TZ=UTC`, so a
 * machine in Lisbon and a runner in California write the same relative time into a screen.
 *
 * A Thursday morning, because `3 days ago` and `yesterday` are what these screens mostly print,
 * and a run at midnight would have half of them tick over mid-shoot.
 */
const FROZEN = Date.UTC(2026, 0, 15, 9, 30, 0)

const Real = Date

/** The same Date, except that asking it what time it is always gets the same answer. */
function Frozen(...args) {
  // Called without `new`, `Date()` is the current time as a string; everything else constructs.
  if (!new.target) return new Real(FROZEN).toString()
  return args.length === 0 ? new Real(FROZEN) : new Real(...args)
}
Frozen.prototype = Real.prototype
Frozen.now = () => FROZEN
Frozen.parse = Real.parse
Frozen.UTC = Real.UTC

globalThis.Date = Frozen

/**
 * A dice that rolls the same sequence every run.
 *
 * A screen that picks a look, an id or a placement at random is a screen whose baseline is a
 * different picture each time it is taken — and `baseline` would fail it as flaky rather than
 * record it. This is a plain multiplicative generator; nothing here wants randomness that is hard
 * to guess, only randomness that is the same twice.
 */
let seed = 0x2f6e2b1
globalThis.Math.random = () => {
  seed = (seed * 48271) % 0x7fffffff
  return (seed - 1) / 0x7ffffffe
}
