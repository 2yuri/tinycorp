# How we write TypeScript

The rules a reviewer will hold you to, each with two lines showing what is meant. `ARCHITECTURE.md`
says where code goes and which way it points; this says what it looks like once it is there.

None of this is style for its own sake. Every rule here is a bug somebody actually shipped.

## Less code

The repo is read far more often than it is written, and by people and agents who have never opened
it before. So:

- **Reuse before writing.** Search for the function before adding a second one that does the same
  thing. `pnpm knip` lists what nothing imports; if it names your new helper, it was not needed.
- **Delete before adding.** A change that removes a branch is better than one that adds a flag.
- **No abstraction nobody asked for.** One caller is not a pattern. A wrapper with one
  implementation and one use is one more file to read and nothing else. Wait for the second case.
- **A new dependency needs a reason.** Say in the pull request what it does, what it would take to
  write instead, and what it pulls in. We ship an unsigned desktop app on three platforms; every
  dependency is also a supply chain.
- **A comment says *why*.** What the code does is in the code. If a line is surprising, the comment
  says what would go wrong without it.

```ts
// Half the cores, not all of them: several worktrees often run the suite at once, and a run that
// takes every core leaves the machine unusable while it lasts.
maxWorkers: '50%',
```

## Errors: expected failures are values, bugs throw

An **expected failure** is something the boss can be told: a folder that is gone, a name that is
taken, a CLI that is not signed in. It comes back as data.

```ts
if (!existsSync(folder)) return { ok: false, error: `${folder} is not there any more` }
return { ok: true, value: openCompany(folder) }
```

A **bug** is something no message helps with: an invariant broken, a case that cannot happen. It
throws, and the throw carries the fact, not an apology.

```ts
const adapter = providers[employee.provider]
if (!adapter) throw new Error(`No provider adapter for ${employee.provider}`)
```

At the IPC seam the two meet: `attempt` in `src/main/core/ipc-kit.ts` runs the handler and turns
whatever comes out into a `Result<T>` — so a throw in the engine reaches the renderer as a sentence
instead of an unhandled rejection with a stack in it.

```ts
ipc.handle(companyChannels.open, (_event, folder) => attempt(() => engine.openCompany(requireString(folder, 'folder'))))
```

Never `catch {}` to move on. Either the failure is expected and is returned, or it is a bug and is
allowed to travel.

## Parse, don't validate, at the boundaries

There are exactly two places where data arrives that TypeScript has not seen: **IPC input from the
renderer**, and **files read from disk** (a Company's own JSON, a Provider's config, a hook
payload). At those two places, turn `unknown` into a type. Everywhere else, the type is already
true.

```ts
// At the seam: a string is proved, not asserted.
const id = requireString(input['id'], 'Company id')
```

```ts
// Never past it: a cast is a promise the compiler cannot keep.
const id = (input as { id: string }).id
```

A parse returns the narrow type or refuses. `isRecord`, `requireString` and the per-module
`somethingInput()` functions are what that looks like here; `zod` is available for a shape big
enough to be worth a schema.

A file that does not parse is a refusal with the path in it, never a silent default — the boss
should learn their Company is broken from a sentence, not from an empty screen.

## Types

**No `any`.** `unknown` at a boundary and a parse after it. If a third-party type forces your hand,
write the reason on the line above.

```ts
const payload: unknown = JSON.parse(text)
```

**No non-null `!` without a one-line reason.** `noUncheckedIndexedAccess` is on, so an index gives
`T | undefined` and it is usually telling the truth.

```ts
// The catalogue is the source of the ids, so an entry for one of them always exists.
return PROVIDER_CATALOGUE.find((entry) => entry.id === provider)!
```

**Discriminated unions, and an exhaustive switch.** A new case then fails the build at every place
that has to care, which is the whole point of having the union.

```ts
type SessionSignal = 'ready' | 'busy' | 'idle' | { kind: 'asking'; what: string }
```

```ts
default:
  return assertNever(command, 'board command') // src/shared/platform/assert-never.ts
```

**Named exports only.** A default export is renamed by every importer, and nothing can grep for it.

```ts
export function createBoard(deps: BoardDeps): Board {}
```

**`as` needs a reason, and a guard is better than a cast.** A cast is a claim the compiler stops
checking. When the value comes from outside, narrow it with a predicate the next reader can trust.

```ts
function isColumn(value: string): value is Column {
  return (COLUMNS as readonly string[]).includes(value) // COLUMNS is where the ids come from
}
```

**What a module exports has an explicit return type.** Inference is fine inside a file; at an
`index.ts` the signature is the contract, and it should not change because a body did.

**An optional field is a key that may be missing, never a key holding `undefined`.**
`exactOptionalPropertyTypes` is on (T191), so `x?: T` and `x?: T | undefined` are two different
promises. Everything that is data — what crosses IPC, what goes in the database, what is read back
from a file, and a patch where a key that is not there means "leave this alone" — is `x?: T`, and a
caller with a value that may be nothing leaves the key out rather than writing `undefined` into it.

```ts
board.updateTicket(id, { title, ...(description !== undefined && { description }) })
```

A **component's props** are the other case, and are written `x?: T | undefined`: JSX writes
`undefined` for a value that is not there, so a parent forwarding its own optional prop is passing
undefined whether it means to or not, and React cannot tell the two apart anyway.

```ts
export interface AvatarProps {
  sprite?: number | undefined
}
```

**`satisfies` and `as const` for tables.** The table keeps its literal types and is still checked
against the shape it promises.

```ts
export const COLUMN_LABEL = {
  planning: 'Planning', todo: 'To do', doing: 'Doing', review: 'Review', testing: 'Testing', done: 'Done',
} as const satisfies Record<Column, string>
```

**`interface` for an object's shape, `type` for unions and aliases.** Interfaces give shorter
errors and extend without intersections.

**No type gymnastics.** A plain type a newcomer reads in five seconds beats a clever mapped
conditional type. Reach for the clever one only in a shared utility, with a test of its own.

**When two strings can be swapped by accident, brand them.** An Employee id and a ticket id are
both strings, and a function that takes both can be called the wrong way round. New code where
that matters uses a brand; existing ids are not rewritten for its own sake.

```ts
type EmployeeId = string & { readonly __brand: 'EmployeeId' }
```

## Shape

**`createX(deps)` factories, not classes.** The dependencies are an interface narrow enough to
implement in a test in three lines, and the thing that comes back is an object of functions. Use a
class only when something genuinely has identity and state that outlives a call.

```ts
export function createFileChanges({ places, limit = CHANGES_LIMIT }: FileChangesDeps): FileChanges {}
```

**No module-level mutable state.** A `let` at the top of a file is shared by every test in the
worker and by every Company the app opens. Put it in the closure the factory returns.

```ts
// Inside createX, not beside it.
const cache = new Map<string, Snapshot>()
```

**A popover closes the two ways every desktop menu closes.** Escape, and a pointer down outside
it — `useDismiss` from `src/renderer/src/ui`, which subscribes only while the thing is open. Put its
`popover` ref on the box, and its `trigger` ref on the button as well where the two are not in one
subtree, so a press on the button reaches its own toggle rather than being read as outside. Closing
on the pointer *leaving* the box is not one of the two: it is the only way out the Employee card's
menu had, and a menu whose box stopped taking pointer events therefore had none at all (T223).

**IO at the edges, pure logic in the middle.** The function that decides goes in `src/shared` or in
the feature's engine and takes plain data; the function that reads a file or spawns a process is
thin and sits above it. That is why most of this repo's tests need no temp folder.

```ts
export function answererChain(employees: Employee[], overrideId: string | null = null): Employee[] {}
```

## Tests

**Fakes, not `vi.mock`.** A fake is a real implementation of the same narrow interface, it is
typed, and it fails the build when the interface changes. `vi.mock` fails nothing and quietly
describes an interface that no longer exists.

```ts
const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), git: fakeGit() })
```

**Write the test that would have caught the bug**, not the test that describes the code. A test
named after a flow the boss can see is worth ten named after a function.

**A fixture that names a path writes it POSIX and wraps it in `onDisk()`**, so the test says the
same thing on the Windows runner.

```ts
engine.createCompany({ folder: onDisk('/work/acme') })
```

**A test that needs a document is named `*.dom.test.tsx`.** That is how `vitest.config.ts` picks
it; a comment at the top of the file is not.

## How a screen reads the engine

Everything on a screen arrived over IPC, and **a screen reads a channel through
`src/renderer/src/ipc`, never through `window.tinyCorp` directly.** One store per channel, shared by
every component that reads it: the first reader subscribes and reads, the rest join what is already
there, and the last one to go drops it. Before T212 fifteen files read `staff.employees()` and
sixteen subscribed to `staff.onChanged`, so one hire cost a dozen reads and a dozen renders.

```ts
// Every screen that draws a name reads the same list, read once.
const employees = useIpcResource(resources.employees)
```

```ts
// Not this: a copy of the answer, and one more subscription on the same channel.
const [employees, setEmployees] = useState<Employee[]>([])
useEffect(() => {
  void window.tinyCorp.staff.employees().then((r) => r.ok && setEmployees(r.value))
  return window.tinyCorp.staff.onChanged(refresh)
}, [])
```

**A channel is a `const` in `src/renderer/src/ipc/resources.ts`**: how to read it, the areas of the
bridge it names, what a reader sees before the first answer, and every event after which what was
read is stale. A resource subscribes to *its own* channel; a value that really does move with another
feature says so on the line, and `resources.dom.test.ts` holds the whole table.

**The Company switch is nobody's event.** `useIpcResource` watches `company.onChanged` once for the
whole renderer and invalidates every channel when the id changes, so an answer already in flight is
dropped rather than drawn under the new Company. That is what a screen used to get by accident by
reading its repos on `staff.onChanged`.

**This is the one place with module-level mutable state**, and it is the reason the rule above exists
rather than an exception to it: a cache every reader shares is what makes it one subscription. It
holds nothing while nobody is looking — the last reader to go empties its store — so a test that
unmounts starts clean and no Company sees what the last one read.

## How we style

**There is no CSS left in the renderer (T216).** Every screen and every kit component states its
own styling as utilities on the element it draws. `find src/renderer -name '*.css'` lists two files
— `ui/tailwind.css`, the whole of the setup, and `ui/tokens.css`, the custom properties it reads —
and `ui/stylesheets.test.ts` fails on a third.

**Utilities first, the kit for components.** A screen is a list of utilities on the markup it
already has. Something two screens both draw — a button, a card, a field — is a kit component in
`src/renderer/src/ui/kit`, written the same way.

```tsx
<section className="inset-ring-1 inset-ring-border flex flex-col gap-14 rounded-md bg-card p-18">
```

**Tokens, never a hex, never a raw size.** The colours are `ui/tokens.css`, exported to Tailwind as
`bg-card`, `text-muted-foreground`, `shadow-menu`. The type is the scale in the same file: the
number is the measurement, so `text-11-5` is 11.5px on the 17px line the frames put it on, and
`text-11-5/14` keeps the size and moves the line. `--spacing` is 1px, so `p-16` is 16px and
`gap-14` is 14px. A hex or a `text-[13px]` in a diff is a question in review.

```tsx
<p className="m-0 text-12/17 text-muted-foreground">{addon.description}</p>
```

**`cx` is `tailwind-merge`, and it is what makes a component adjustable.** The kit writes `gap-8` on
its own element and a screen passes `gap-6` for the same one. Both are one class in
`@layer utilities` with the same specificity, so neither the source order nor where the `className`
sits decides it — Tailwind's own sort order does, and it has no idea which of the two the screen
meant. That is the tie T213 measured, and `cx` unties it: the caller's class goes last and
`tailwind-merge` drops the one it replaces.

```tsx
export function Card({ className, ...rest }: CardProps) {
  return <div data-slot="card" className={cx(CARD, className)} {...rest} />
}
```

**It is configured for our theme, and it has to be.** `tailwind-merge` reads `text-13` against
Tailwind's own type scale, finds no size called `13`, and files it as a *colour* — so
`cx('text-foreground', 'text-13')` comes back as `text-13` with the colour dropped. Our four
scales — the type, the elevations, the animations, the two families — are named in `ui/kit/cx.ts`,
and `cx.test.ts` pins each of them against the keys `ui/tailwind.css` really declares, so a size
added to the theme and not to `cx` fails there rather than in a pixel.

**Every class list goes through it, and none is joined by hand (T226).** A template string walks
straight past `cx`: `` `${FIELD} ${LOOK}` `` put `w-full` and `w-132` on one element and the Hire an
Employee modal scrolled sideways until T224 found it, because the sheet's order picked the winner
rather than the author. So a class list is written `cx(a, b, 'lit')` — the callee's defaults first,
the caller's classes last — wherever two of them meet, whether that is a `className`, a constant
built out of another constant, or one entry of a variant table. `tailwind.test.ts` reads the
renderer's source and fails on a template string, a `+` or a `.join(' ')` in any of those places.
One dynamic class name is not a join: `` `files-token--${kind}` `` has nothing beside it to tie
with, and is left alone.

**Variants are `class-variance-authority` tables.** A component's size, tone and state are one
typed table, in the order the frames resolve them, and `cx` settles what is left.

```ts
const badge = cva('inline-flex shrink-0 items-center rounded-full …', {
  variants: {
    size: { md: 'gap-6 px-11 py-5 text-12/[normal]', sm: 'gap-0 px-10 py-4 text-11/[normal]' },
    variant: { neutral: 'bg-secondary text-secondary-foreground', … },
  },
  defaultVariants: { size: 'md', variant: 'neutral' },
})
```

**A component's parts are `data-slot`, the way shadcn/ui does it.** `data-slot="field-control"`, and
`data-variant` / `data-size` / `data-tone` / `data-error` for what it is doing. A screen reaches a
part with an arbitrary variant, which is a two-part selector and so beats the component's own
one-class utility on specificity:

```tsx
// A 36px field where the kit draws a 40px pill.
const SEARCH_FIELD = '[&_[data-slot=field-control]]:h-36 [&_[data-slot=field-control]]:rounded-sm'
```

**Adjust a state and you adjust it in every state it has.** `focus-within:px-12` in the component is
already a two-part selector, so a screen's plain `[&_[data-slot=field-control]]:px-13` weighs the
same and the order decides. A screen that sets a control's padding sets its `focus-within` padding
too. What no selector can reach is a prop instead — `Select`'s `lead`, for the ticket modal's row
that puts an Employee's tile where the icon goes.

**Two variants on the same parent can both match the same child, and then nothing you wrote
decides it.** `[&>*:not([data-card=open])]:pointer-events-none` and
`[&_[data-card=menu]]:pointer-events-auto` are both one class and one attribute, so they weigh the
same on the Employee card's menu, which is a direct child — and Tailwind emits `none` last. T223 is
what that cost: the open menu was `pointer-events: none`, so Edit did nothing, no row of it did
anything, and it could not be closed either, because it never got the events that close it. `cx`
cannot untie this one — the two classes are on the parent, not on the element. Make the rules
mutually exclusive instead: one more `:not()` on the wider of them, so only one of the two can ever
match. **A stylesheet this came from is not evidence that it works**: in CSS the tie went to
whichever rule was written later, and the migration reordered them.

**A test reads `data-slot`, never a class list.** `expect(html).toContain('ui-badge--neutral')` was a
test of the stylesheet; `data-variant="neutral"` is a test of the component. Utilities move under a
frame measurement and the attribute does not.

**Three things fail silently, and one test catches all three.** `ui/tailwind.test.ts` compiles the
real setup, so none of them can reach a screen:

- **A theme key that is not there.** `font-bold` with no `--font-weight-bold` compiles to *nothing*
  — no warning — and the heading renders at 400. Every class a Tailwind screen writes has to
  produce a rule.
- **A theme key that maps to itself.** `--radius-s: var(--radius-s)` is the one thing `@theme
  inline` writes out, to an unlayered `:root, :host`, where it refers to itself and is invalid at
  computed-value time — taking the token out from under every screen in the app. So a theme key
  never repeats the name of the token it reads: the radii are `sm`/`md`/`lg`/`full` against our
  `s`/`m`/`l`/`pill`, the shadows read `--elevation-*`, the mono font is `--font-code`.
- **A class whose source text is not what React writes.** `'\\_\\_'` in a quoted string is `\_\_`
  at runtime and `\\_\\_` in the file; Tailwind reads the file and generates a rule that matches
  nothing. Any class list with a backslash in it is a `String.raw` template.

**Three layers, declared once.** `@layer theme, base, utilities;` at the top of `ui/tailwind.css`.
`theme` is Tailwind's, empty while every key is `inline`; `base` is the document defaults;
`utilities` is last, so a class beats the reset under it and no rule in this repo needs `!`.

**`base` declares no class.** Every rule in it is about an element — `html`, `body`, a control's
inherited font — or is an at-rule that cannot be a class at all. A class rule in a stylesheet is
styling that lives somewhere other than the thing it styles, and a shared reset is a class list
instead: `SHELL_BUTTON` and `CHOICE_INPUT` in `ui/kit/resets.ts`, passed through `cx` so a caller
out-writes them rather than having to out-weigh them. `stylesheets.test.ts` fails on a class
selector in that file.
Tailwind's own base layer is preflight — it restyles every element in the document rather than the
subtree that asked for it — so this setup imports the utilities alone and there is no Tailwind base
layer in the compiled sheet at all.

**An editable document is styled from the element above it.** TipTap — the rich markdown editor the
Memory page is written in (T225) — writes plain `h2`, `ul`, `pre` and `blockquote` elements with no
class of their own, the same shape `MarkdownBody` renders, so the container reaches them with
`[&_h2]:…` exactly as the reading pane does. The Memory screen hands the editor the very list its
own reading pane uses (`BODY` in `memory/MemoryPageView.tsx`), which is what makes the WYSIWYG
true: the page is written in the type it will be read in. Nothing is injected at run time and
`stylesheets.test.ts` still finds two stylesheets.

**Monaco is the same story, with one trap of its own.** The Files editor (T222) is VS Code's
editor, and it takes its colours as a theme rather than as classes: `editor/monaco-theme.ts` reads
`--code`, the seven `--syntax-*` and the widget tokens off the live document and builds the two
themes from them, the way `live-markdown.ts` does for CodeMirror. **What is left for a class is a
decoration, and a decoration's class list may hold letters, digits, `-` and `_` and nothing else.**
Monaco runs every one through its own `cleanClassName`, which replaces every other character with a
space — so `bg-[color-mix(…)]`, `bg-brand-warning/10` and every other arbitrary or modified utility
arrives as fragments matching no rule, silently. A wash is therefore a solid token colour and an
`opacity-*` beside it, and the gutter marks are Monaco's own codicons tinted with `text-*`.

**A folder opts in by name.** `ui/tailwind.css` has one `@source` line per folder or file that
writes a class, because the test compiles *every* class those files write. A new folder is one more
`@source` line and one more entry in `biome.jsonc`'s `useSortedClasses` override.

**`pnpm design:compare` is the bar.** A styling change that is
meant to look the same has to leave all 98 baseline states under the 0.3% floor. A state that moves
has a tie behind it; find it before you re-baseline it.

## Before you open a pull request

Tick each one in the description, or say why it does not apply.

- [ ] No `any`; `unknown` plus a guard at every boundary.
- [ ] Every `as` and every `!` carries its reason.
- [ ] An optional field that is data is `x?: T` and the caller leaves the key out; only a
      component's props are `x?: T | undefined`.
- [ ] What `index.ts` exports has explicit types, and nothing internal leaks through it.
- [ ] Unions are discriminated and every switch over one ends in `assertNever`.
- [ ] Expected failures are values; only bugs throw.
- [ ] No module-level mutable state; IO at the edges.
- [ ] A screen reads a channel through `src/renderer/src/ipc`, not `window.tinyCorp`, and a new
      channel is one `const` in its catalogue and one row in its table.
- [ ] The diff is the smallest one that does the job: nothing reinvented that the repo, the
      standard library or the platform already has.
- [ ] A styling change is tokens and utilities, each sheet in its layer, and `pnpm design:compare`
      moves nothing unless the ticket asked it to.
- [ ] Tests use fakes, read as sentences, and would fail if the change were reverted.
- [ ] `pnpm lint`, `pnpm knip`, `pnpm typecheck` and `pnpm test` are green.

Agents working in this repo load the `typescript-expert` skill when it is available and go through
this list before they open the pull request.

## Where the rest of it is

- `ARCHITECTURE.md` — the modules, the direction, the invariants.
- `docs/architecture/modules.md` — which file is in which module.
- `src/architecture.test.ts` — the boundaries, checked.
- `AGENTS.md` — the commands, the layout, the conventions.
- `CONTRIBUTING.md` — what a pull request has to contain.
- `biome.jsonc` — the rules a machine can check. A rule that is off carries its reason beside it.
