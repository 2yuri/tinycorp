/**
 * The branch that cannot happen, proved by the compiler.
 *
 * Put it in the `default` of a switch over a discriminated union, or after the last case of one
 * that returns nothing. A case added to the union then fails the build here, which is the whole
 * reason for having the union: without it, a new kind silently does nothing and the screen that
 * asked for it simply never changes.
 *
 * It throws as well, because the union is only proved for callers the compiler can see — a value
 * read off disk or off the wire can still be a word nobody wrote a case for.
 */
export function assertNever(value: never, what = 'value'): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`)
}
