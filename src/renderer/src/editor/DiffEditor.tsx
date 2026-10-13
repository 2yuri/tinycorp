import { ChevronDown, ChevronUp, Columns2, Rows3 } from 'lucide-react'
import {
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cx } from '../ui'
import {
  changesLabel,
  DIFF_LAYOUT_KEY,
  type DiffLayout,
  type DiffMark,
  type DiffOverlay,
  layoutFor,
  readDiffLayout,
  stepChange,
} from './diff-model'
import { monacoLanguageOf } from './monaco-model'
import '../ui/tailwind.css'

/**
 * The diff surface of this app: VS Code's own diff editor (T243).
 *
 * Both places that draw a diff draw it with this one — the Review screen over a PR, the Files
 * view's Changes tab over a worktree — where before each had a hand-written unified diff of its
 * own. It is given the two whole sides of a file and works the diff out itself, which is what
 * makes collapsing the unchanged stretches, next and previous change, and real syntax colouring
 * something the editor already does rather than something this app reimplements.
 *
 * **It arrives on T222's chunk, not a second one.** `./DiffMonaco` imports `./monaco`, the same
 * module `CodeMonaco` does, so opening a diff and opening a file pull the same lazy chunk and the
 * startup bundle holds neither.
 *
 * **And it is the seam the tests mock.** Monaco measures text and needs a layout, which jsdom has
 * none of; `review-panel.dom.test.tsx` and `files-view.dom.test.tsx` replace this module and press
 * the same wires. Everything decided *about* it is in `diff-model.ts`, which is plain data.
 */

/** What a screen hands the editor and its control bar, held by `useDiffControls`. */
export interface DiffControls {
  /** The way the diff is really drawn: what the boss chose, or what this much room allows. */
  layout: DiffLayout
  /** Pressing the toggle. It is a choice, and a choice outlives the pane it was made in. */
  setLayout(layout: DiffLayout): void
  /** Which change of how many the boss is on; `{ current: 0, total: 0 }` for an unchanged file. */
  changes: { current: number; total: number }
  next(): void
  previous(): void
  /** Spread onto `<DiffEditor>`; the editor reads the layout and answers where the changes are. */
  bind: {
    layout: DiffLayout
    /** Bumped by `next`/`previous`; the editor reveals `goTo.change` whenever `goTo.seq` moves. */
    goTo: { seq: number; change: number }
    onChanges(total: number): void
    onAt(current: number): void
    onWidth(width: number): void
  }
}

/**
 * The diff's own controls, held by the screen so its header can draw them: which way it is laid
 * out, and where the boss is in the file's changes.
 *
 * **The layout is a choice, and a width until one is made** (T244). A pane under
 * {@link SPLIT_MIN_WIDTH} opens inline, because two columns of it are unreadable and a comment
 * thread in one of them is worse; pressing the toggle is the boss saying otherwise, and that
 * outlives the screen — it is their way of reading a diff, not this file's — so it is written to
 * `localStorage` rather than kept per pane. A window with no storage (a capture harness in a
 * sandbox) simply decides by width every time.
 */
export function useDiffControls(): DiffControls {
  const [chosen, keep] = useState<DiffLayout | null>(() => readDiffLayout(read(DIFF_LAYOUT_KEY)))
  const [width, setWidth] = useState(0)
  const [total, setTotal] = useState(0)
  const [current, setCurrent] = useState(0)
  const [goTo, setGoTo] = useState({ seq: 0, change: 0 })
  const layout = layoutFor(width, chosen)

  const setLayout = useCallback((next: DiffLayout) => {
    keep(next)
    write(DIFF_LAYOUT_KEY, next)
  }, [])

  const step = useCallback(
    (direction: 1 | -1) => setGoTo((was) => ({ seq: was.seq + 1, change: stepChange(current || 1, total, direction) })),
    [current, total],
  )

  const onChanges = useCallback((count: number) => {
    setTotal(count)
    setCurrent((was) => (count === 0 ? 0 : Math.min(Math.max(was, 1), count)))
  }, [])

  return useMemo(
    () => ({
      layout,
      setLayout,
      changes: { current, total },
      next: () => step(1),
      previous: () => step(-1),
      bind: { layout, goTo, onChanges, onAt: setCurrent, onWidth: setWidth },
    }),
    [layout, setLayout, current, total, goTo, onChanges, step],
  )
}

/** `localStorage` is a window's, and a sandboxed one throws on the very first read. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // A window that will not keep it still draws the diff; the choice just does not outlive it.
  }
}

const BAR_BUTTON =
  'inline-flex cursor-pointer items-center gap-4 rounded-sm border-0 bg-transparent px-6 py-4 text-11/[inherit] font-semibold text-muted-foreground not-disabled:hover:bg-secondary disabled:cursor-default disabled:opacity-40'

/**
 * The bar both screens put in their own header: side by side or inline, and the walk through the
 * file's changes. Buttons rather than a shortcut, so it says the same thing and works the same way
 * on all three platforms — there is no `Cmd` here to have a `Ctrl` twin of.
 */
export function DiffControlBar({ controls, className }: { controls: DiffControls; className?: string }) {
  const { changes } = controls
  return (
    <span className={cx('flex shrink-0 items-center gap-2', className)} data-slot="diff-controls">
      <button
        type="button"
        className={BAR_BUTTON}
        aria-pressed={controls.layout === 'split'}
        title={controls.layout === 'split' ? 'Reading side by side' : 'Read side by side'}
        aria-label="Side by side"
        onClick={() => controls.setLayout(controls.layout === 'split' ? 'inline' : 'split')}
      >
        {controls.layout === 'split' ? <Columns2 size={13} aria-hidden /> : <Rows3 size={13} aria-hidden />}
      </button>
      <button
        type="button"
        className={BAR_BUTTON}
        disabled={changes.total === 0}
        aria-label="Previous change"
        title="Previous change"
        onClick={controls.previous}
      >
        <ChevronUp size={13} aria-hidden />
      </button>
      <button
        type="button"
        className={BAR_BUTTON}
        disabled={changes.total === 0}
        aria-label="Next change"
        title="Next change"
        onClick={controls.next}
      >
        <ChevronDown size={13} aria-hidden />
      </button>
      <span className="font-code text-10-5/[inherit] text-muted-foreground tabular-nums">
        {changesLabel(changes.current, changes.total)}
      </span>
    </span>
  )
}

export interface DiffEditorProps {
  /** The path at the head; what the model is keyed by and how the language is picked. */
  path: string
  /** `OpenedFile.language` — the coarse id; the extension is what really picks the grammar. */
  language?: string | null | undefined
  /** The whole file as the base has it; empty for a file the change added. */
  original: string
  /** The whole file as the head has it; empty for a file the change removed. */
  modified: string
  layout: DiffLayout
  /** Bumped by the control bar; the editor reveals `change` whenever `seq` moves. */
  goTo?: { seq: number; change: number } | undefined
  /**
   * A line to scroll to, whenever `seq` moves: `Jump to open thread` in the review panel. It is the
   * editor's job rather than a `scrollIntoView` on the zone, because an unchanged stretch is folded
   * away and only the editor can unfold it.
   */
  reveal?: { seq: number; line: number } | undefined
  /** How many changes the editor found, and which one the boss is on. */
  onChanges?: ((total: number) => void) | undefined
  onAt?: ((current: number) => void) | undefined
  /**
   * How much room the diff has, whenever that changes. It is what picks the layout for a boss who
   * has never picked one, so it is measured on the frame — which is always mounted — rather than
   * inside Monaco, which arrives a chunk later and would draw split first and inline after.
   */
  onWidth?: ((width: number) => void) | undefined
  /** What hangs under a line: the comment thread, the review threads, the findings. */
  overlays?: readonly DiffOverlay[] | undefined
  /** Draws one overlay's body; called inside the view zone Monaco makes for it. */
  children?: ((overlay: DiffOverlay) => ReactNode) | undefined
  /** The lines with something said about them, marked in the gutter and the overview ruler. */
  marks?: readonly DiffMark[] | undefined
  /**
   * Clicking a line of the head side, where a comment can be written there. Left out, the diff is
   * read only: the Company's own repo has no ticket to comment on (T160).
   */
  onCommentOn?: ((line: number | null) => void) | undefined
}

/* The frame the editor fills, and the ground it draws on — stated out here, so the box is the right
   colour and the right size for the tick the chunk takes to arrive. */
const FRAME = 'flex min-h-0 min-w-0 flex-1 flex-col bg-code'

const Monaco: ComponentType<DiffEditorProps> = lazy(async () => ({
  default: (await import('./DiffMonaco')).DiffMonaco,
}))

export function DiffEditor(props: DiffEditorProps) {
  const { path, language = null, layout, onWidth } = props
  const frame = useRef<HTMLElement>(null)

  // Before the paint, so a pane narrow enough to be inline is never drawn split for one frame.
  useLayoutEffect(() => {
    // `!`: a layout effect runs after the commit, so the box React just drew is there.
    const element = frame.current!
    if (onWidth === undefined) return
    onWidth(element.clientWidth)
    const observer = new ResizeObserver(() => onWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [onWidth])

  return (
    <section
      ref={frame}
      className={FRAME}
      data-ui="Diff editor"
      data-path={path}
      data-language={monacoLanguageOf(path, language)}
      data-layout={layout}
      aria-label={`Diff of ${path}`}
    >
      <Suspense fallback={null}>
        <Monaco {...props} />
      </Suspense>
    </section>
  )
}
