/**
 * The logos vendored into this folder, by file name without the extension.
 *
 * **A glob, not an import list, so that this file names no product.** The renderer may write down
 * no Provider and no forge — `no-provider-names.test.ts` and `no-forge-names.test.ts` read every
 * `.ts` and `.tsx` under `src/renderer` looking for one — and a table of `import … from
 * './….svg'` would be a screen naming both in the same breath. So the folder is read whole at
 * build time and a catalogue entry asks for its own file by the name it already carries in
 * `shared`, where the catalogue lives. Neither test reads a `.svg`, which is the point: a
 * product's name is data here, and the data comes from the catalogue.
 *
 * `eager` with `?url` means Vite emits each file once beside the bundle and the value here is the
 * URL to it. Nothing is inlined into the JavaScript, nothing is fetched at runtime, and only the
 * files really in this folder ship — neither icon package is a dependency of this app.
 */
const FILES: Record<string, string> = import.meta.glob('./*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

const URLS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\//, '').replace(/\.svg$/, ''), url]),
)

/** The URL of a vendored logo, or null for a name this build has no file for. */
export function logoUrl(name: string | null | undefined): string | null {
  return (name && URLS[name]) || null
}

/** Every vendored logo's name, sorted. What `logos.test.ts` reads back against the catalogues. */
export function vendoredLogos(): readonly string[] {
  return Object.keys(URLS).sort()
}
