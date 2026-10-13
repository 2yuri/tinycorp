import { type ComponentType, lazy, Suspense } from 'react'
import type { CodeSpot, Defined, Diagnosed, Hovered } from '../../../shared/files/language'
import { monacoLanguageOf } from './monaco-model'
import '../ui/tailwind.css'

/**
 * The code surface of the Files view: VS Code's own editor, read-only for a file the boss is
 * looking at and writable for one they are typing in (T222).
 *
 * **It arrives lazily**, the way xterm and Pixi do since T211: Monaco is the largest thing this app
 * draws and only this screen draws it, so the Launcher, the onboarding wizard and the preflight
 * cards must not be served it. The `<Suspense>` is inside, because the fallback is the code surface
 * itself — an empty one, at the colour the editor is about to fill it with, so the panel does not
 * flash a different ground for the tick the chunk takes.
 *
 * **And it is the seam the tests mock.** Monaco measures text and needs a layout, which jsdom has
 * none of; `files-view.dom.test.tsx` replaces this module with a textarea and presses the same
 * wires. Everything decided *about* the editor is in `monaco-model.ts` and `monaco-theme.ts`, which
 * are plain data and are tested for real.
 */

/** What the place's language server can answer about the file in the box (T115). */
export interface CodeServer {
  /** The type and the doc comment under the pointer; null when the server knows nothing there. */
  hover(spot: CodeSpot): Promise<Hovered | null>
  /** Where the symbol at a spot is declared; null when the server knows nowhere. */
  definition(spot: CodeSpot): Promise<Defined | null>
  /** Follows a declaration: the view opens it as a tab, in its own place, on its own line. */
  open(at: Defined): void
}

export interface CodeEditorProps {
  /** The text in the box: the boss's own where they have some, else the file as it was read. */
  text: string
  /** Relative to the place, or the whole path for a file from outside the Company (T121). */
  path: string
  /** The place the file is in; null for one from outside, which no server speaks for. */
  placeId?: string | null | undefined
  /** `OpenedFile.language` — the coarse id; the extension is what really picks the grammar. */
  language?: string | null | undefined
  /** True when the file may only be read: the caret still moves and Find still works. */
  readOnly?: boolean | undefined
  /** The lines the Employee changed, striped down the gutter as the viewer has always marked them. */
  changedLines?: readonly number[] | undefined
  /** The line a path written elsewhere named (T114): the editor scrolls to it and marks it. */
  markedLine?: number | null | undefined
  /** What the language server complains about, as squiggles and marks beside the line. */
  diagnostics?: readonly Diagnosed[] | undefined
  /** Without one the editor only colours: no card, no go-to-definition. */
  server?: CodeServer | undefined
  onChange?: ((text: string) => void) | undefined
  onSave?: (() => void) | undefined
}

/*
 * The frame the editor fills, and the ground it draws on — stated here rather than inside, so the
 * box is the right colour and the right size for the tick the chunk takes to arrive.
 */
const FRAME = 'flex min-h-0 min-w-0 flex-1 flex-col bg-code'

const Monaco: ComponentType<CodeEditorProps> = lazy(async () => ({
  default: (await import('./CodeMonaco')).CodeMonaco,
}))

export function CodeEditor(props: CodeEditorProps) {
  const { path, language = null, readOnly = false } = props
  // What the editor is about is said out here, where it costs nothing: which file, in which
  // language, and whether the boss may type in it. `monacoLanguageOf` is a lookup table, not
  // Monaco, so the frame can answer for the chunk before the chunk is there — and a static render
  // (`FilesView.test.tsx`) reads the same three attributes an Electron window would.
  return (
    <section
      className={FRAME}
      data-ui="Code editor"
      data-path={path}
      data-language={monacoLanguageOf(path, language)}
      data-readonly={readOnly ? 'true' : 'false'}
      aria-label={readOnly ? path : `Edit ${path}`}
    >
      <Suspense fallback={null}>
        <Monaco {...props} />
      </Suspense>
    </section>
  )
}
