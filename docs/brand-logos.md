# Brand logos

TinyCorp draws other people's logos in a handful of places: a Provider's logo where the app asks
which coding CLI an Employee runs on, and a service's logo where it asks which MCP server to
connect to. This page is what that is allowed to be, and how to add one.

## What they are for, and what they are not

A logo here **identifies the service an integration connects to**, and nothing else. It is drawn
beside that service's own name, in a list of things the boss can pick, so the row is found by eye
instead of by reading. That is nominative use: the marks are their owners' trademarks, and drawing
one is not a claim that its owner endorses TinyCorp, is affiliated with it, or has reviewed the
integration. Nothing in the app implies otherwise, and no logo is used as a badge, an
endorsement, a partner list or decoration.

If a trademark owner would rather TinyCorp did not draw their mark, take the file out of
`src/renderer/src/ui/logos/` and the name off its catalogue entry. The generic mark under it takes
over on the next render, and the app loses nothing but a picture — see **How the fallback works**.

## The two sets, and why there are two

| Set | Licence | What it covers | Where it wins |
| --- | --- | --- | --- |
| [LobeHub Icons](https://lobehub.com/icons) (`@lobehub/icons-static-svg`) | MIT | AI and LLM products | Everything it has, because it draws the coding CLIs and it has real colour variants |
| [Simple Icons](https://simpleicons.org) | CC0-1.0 | Popular brands generally | Whatever LobeHub does not have |

**LobeHub first, Simple Icons second.** LobeHub is the set that knows this app's own subject — it
has Claude Code, Codex and OpenCode, which nothing else does — and it ships a colour variant of
many of its marks, which is the mark as its owner draws it. Simple Icons is the fallback because
it is CC0 and covers the rest of the world, at the cost of being monochrome by design.

Neither package is a dependency of this app. **Only the individual `.svg` files that are drawn are
vendored**, into `src/renderer/src/ui/logos/`, with each set's licence text beside them and an
entry in [`NOTICE`](../NOTICE). A folder of 950 icons in the bundle to draw ten of them would be a
bundle nobody chose.

## What may be done to a logo: nothing

A vendored file is **byte-for-byte what the set publishes**. It is not recoloured beyond picking
between the official monochrome and colour variants, not cropped, not redrawn, not squeezed into a
square it was not drawn for, and not composed with anything else.

That is why a logo is drawn as `<img src={…}>` of the file, and never as inline markup through
`dangerouslySetInnerHTML`: an `<img>` cannot be reached by the page's CSS, so no stylesheet can
recolour a mark by accident, and the file the app ships is plainly the file the set published.
`object-contain` is on the element for the same reason — a mark that is not square keeps its own
proportions inside the box the screen gives it.

**The one filter, and what it is for.** This app's own theme is dark by default — `ui/tokens.css`
declares the Dark palette on `:root` and `[data-theme='light']` is the override — and a monochrome
mark is published black: LobeHub's asks for `currentColor`, which in an `<img>` is black, and
Simple Icons' is black outright. Drawn as it comes it is a black glyph on a slate card, which is no
mark at all. So a **monochrome** mark is inverted under the dark theme and only there, which turns
black into white: the same mark, in the other of the two colours a monochrome mark exists to be
drawn in, and exactly what `currentColor` would have given if an `<img>` could see the page. A
**colour** mark is never filtered, on any surface.

Which of the two a file is, is its name: a set publishes its colour variant as `name-color.svg`, so
anything without that suffix is the monochrome one. `logos.test.ts` reads every file back and fails
if its name and its contents disagree.

## How the fallback works

A logo is **optional everywhere**. A Provider says which one it has in
`src/shared/domain/providers.ts` and a preset says so in `src/shared/catalogue/mcp-presets.ts`,
both as the file's name without `.svg`; an entry that says nothing draws the generic mark its
`icon` field already named — a branch for a forge, a card for payments, a bug for error tracking.

Four services keep a generic mark today because neither set carries them: Slack, Playwright,
SigNoz and Context7, plus the Filesystem server, which is not a company at all.

So adding a Provider is still one folder and two lines. A logo is a fourth thing, and nobody has
to have one.

## The renderer never names a product

`src/renderer/src/ui/logos/logo-assets.ts` reads the folder with `import.meta.glob` rather than
importing each file by name. That is not a shortcut: `no-provider-names.test.ts` and
`no-forge-names.test.ts` read every `.ts` and `.tsx` under `src/renderer` and fail on a screen that
writes down a product, because a screen that names one is a screen the next one does not reach. The
name lives in the catalogue, in `shared`, and this folder turns a name into a file.

`src/renderer/src/ui/logos/Logo.tsx` is the only place that draws one, and
`ProviderMark.tsx` and `PresetMark.tsx` are the two seams a screen reaches for, through
`src/renderer/src/ui`.

## Adding one

1. **Check the two sets, in order.** LobeHub first (`@lobehub/icons-static-svg`, the `icons/`
   folder), then Simple Icons. Prefer a `-color` variant where the set publishes one. If neither
   has it, stop: the entry keeps its generic mark, and that is a finished answer.
2. **Copy the one file** into `src/renderer/src/ui/logos/`, keeping the name the set gave it, so
   the file says which set it came from and which variant it is.
3. **Name it on the catalogue entry**: `logo: '<file name without .svg>'` in
   `src/shared/domain/providers.ts` or `src/shared/catalogue/mcp-presets.ts`, and add the name to
   that file's `ProviderLogo` / `McpPresetLogo` union so a typo fails to compile.
4. **Do not edit the file.** If it needs editing to look right, it is the wrong file.
5. **`pnpm test`.** `src/renderer/src/ui/logos/logos.test.ts` fails on a name with no file and on a
   file no catalogue names — a logo this repo would ship, and credit in `NOTICE`, for no reason.
6. **If the set is a third one**, add its licence text beside the files and an entry in `NOTICE`,
   and add a row to the table above saying when it wins.
