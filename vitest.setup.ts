/**
 * An empty preload bridge, for every test that loads a renderer module.
 *
 * The renderer is compiled against `window.tinyCorp`, and a screen takes its own corner of it the
 * moment it is imported — `const api = window.tinyCorp.board`, at the top of the file. Since T202
 * every renderer folder is reached through one front door, so importing one component imports the
 * folder's others too, and a node test that draws a ticket card would die on `window is not
 * defined` before its first line.
 *
 * Empty on purpose, and never a fake: the renderer reads the bridge through `?.` and `??`, so an
 * empty one behaves exactly like a window with no preload — which is the case `hostPlatform()`
 * already promises to answer for. A test that wants an answer out of the bridge still stubs the
 * call it makes, the way it always did.
 */
const holder = globalThis as { window?: { tinyCorp?: unknown } }
holder.window ??= {}
holder.window.tinyCorp ??= {}
