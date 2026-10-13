/**
 * The two variable faces this app is set in, bundled from `node_modules` and never from a network
 * (T216).
 *
 * **They are not in `ui/tailwind.css`, and that is deliberate.** Every component imports that sheet,
 * so an `@import` of the faces there would pull twelve woff2 files into every page that draws
 * anything — including the office capture harness, which draws no DOM text at all: it is a Pixi
 * canvas. The extra work moved that harness's first frames, and the boss's turning emerald was a
 * step further round at the moment the shutter opened. `pnpm design:compare` is what caught it.
 *
 * So the faces are loaded where the document is, by the entry that owns it: `main.tsx` and each
 * capture harness that draws text. It is the same boundary `ui/base.css` drew before this ticket,
 * with one import in place of a stylesheet.
 */
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
