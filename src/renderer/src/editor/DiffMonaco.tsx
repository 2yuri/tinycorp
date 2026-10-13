import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DiffEditorProps } from './DiffEditor'
import { type DiffOverlay, marksOn, overlaysOn } from './diff-model'
import { monaco } from './monaco'
import { monacoLanguageOf } from './monaco-model'
import { appearanceOf, defineThemes, FONT_FAMILY, FONT_SIZE, LINE_HEIGHT } from './monaco-runtime'
import { CODE_THEMES } from './monaco-theme'
import '../ui/tailwind.css'

/**
 * The diff drawn in Monaco's own diff editor (T243).
 *
 * It is given the two whole sides of one file and works the rest out itself: which lines moved,
 * which stretches are unchanged and can be folded away, and how to colour both. What this app adds
 * is what a forge adds — a comment under a line, the review threads, the security findings — and
 * each of those is a *view zone*, the same mechanism VS Code's own comment threads use, with React
 * drawing into it through a portal so a screen keeps writing ordinary components.
 *
 * Nothing in here is drawn by React except those portals: Monaco owns the box, so every prop
 * reaches it through an effect and the callbacks through a ref, and an editor is never torn down
 * to be told a new `onCommentOn`.
 */

/* The box Monaco fills, inside the frame `DiffEditor.tsx` draws. */
const HOST = 'min-h-0 w-full flex-1'

/**
 * The column the two of them share: Monaco below, and the threads above it (T244).
 *
 * `relative` is what {@link LAYER} is positioned against, and the whole point of the pair.
 */
const COLUMN = 'relative flex min-h-0 w-full flex-1 flex-col'

/**
 * Where a thread is really drawn: over the diff, not inside it.
 *
 * A view zone lives in one editor, so in side-by-side a thread drawn into one is half the width of
 * the diff and clipped by that pane's own overflow — 250px at the default window, a word per line
 * (T244). The zone still reserves the height, because only Monaco can push the lines down; what
 * goes in it is an empty box, and the thread itself hangs here, spanning both panes. The layer
 * lets the pointer through and each thread takes it back, so the gutter underneath still opens a
 * composer everywhere a thread is not.
 */
const LAYER = 'pointer-events-none absolute inset-0 overflow-hidden'

/** Where a thread parked before Monaco has said where its line is, and while that line is folded. */
const OFFSCREEN = -100000

/** The scheme the diff's own models live under: nothing registered for the file editor sees them. */
const DIFF_SCHEME = 'tinycorp-diff'

/*
 * **A decoration's class list may hold letters, digits, `-` and `_` and nothing else** — Monaco
 * runs every one through `cleanClassName` and turns anything else into a space. So each of these is
 * a codicon name and one token colour, and never an arbitrary or modified utility.
 */
/** A line somebody has commented on, or that carries a review thread. */
const COMMENT_GLYPH = 'codicon-comment text-muted-foreground'
/** A line a security finding names and nobody has settled yet (T241). */
const FINDING_GLYPH = 'codicon-shield text-brand-warning'
/** The `+` the gutter offers on the line under the pointer, as a forge's diff does. */
const WRITE_GLYPH = 'codicon-add text-primary'

/** Where a comment glyph shows up in the overview ruler, so a long file says where the talk is. */
const RULER = monaco.editor.OverviewRulerLane.Right

/** A view zone in flight: what Monaco knows about it, and the box React draws into. */
interface Zone {
  overlay: DiffOverlay
  /** Monaco's own id, for removing it and asking for it to be laid out again. */
  id: string
  /** Monaco reads `heightInPx` off this object every time the zone is laid out. */
  view: monaco.editor.IViewZone
  /**
   * What React draws into, in {@link LAYER} rather than in the zone: free to be as tall as the
   * thread and as wide as the diff, and moved to the zone's own top on every render Monaco does.
   */
  box: HTMLElement
}

export function DiffMonaco({
  path,
  language = null,
  original,
  modified,
  layout,
  goTo,
  reveal,
  onChanges,
  onAt,
  overlays,
  marks,
  children,
  onCommentOn,
}: DiffEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const models = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null)
  const glyphs = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const hovered = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const zones = useRef<Zone[]>([])
  const [drawn, setDrawn] = useState<Zone[]>([])
  /** The latest of everything the editor calls back into, so it is built once and told the rest. */
  const live = useRef({ onChanges, onAt, onCommentOn })
  live.current = { onChanges, onAt, onCommentOn }

  // The editor itself, built once. Monaco owns everything inside the box from here on.
  useEffect(() => {
    // `!`: the effect runs after the commit, so the box React just drew is there.
    const element = host.current!
    defineThemes(element)
    const instance = monaco.editor.createDiffEditor(element, {
      theme: CODE_THEMES[appearanceOf(element)],
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      automaticLayout: true,
      // A diff is read, never typed in: the boss edits a file in the Files view's own editor.
      readOnly: true,
      originalEditable: false,
      // Monaco falls back to the inline view under 900px of its own accord, which quietly overrules
      // the boss in a pane this width. The toggle says what they chose, so it is theirs to make.
      useInlineViewWhenSpaceIsLimited: false,
      // The unchanged stretches folded away, which is what makes a big file readable at all. Three
      // lines either side of a change stay, and the fold says how many lines it is hiding.
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
      renderOverviewRuler: true,
      minimap: { enabled: false },
      glyphMargin: true,
      lineDecorationsWidth: 8,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      // The colours are this app's seven tokens; bracket pairs would add six nobody named.
      bracketPairColorization: { enabled: false },
      guides: { bracketPairs: false },
      stickyScroll: { enabled: false },
      overviewRulerBorder: false,
      scrollbar: { useShadows: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      fixedOverflowWidgets: true,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      // Its own accessible review pane duplicates the file list and the walk this app already has.
      accessibilityVerbose: false,
    })
    editor.current = instance
    const right = instance.getModifiedEditor()
    glyphs.current = right.createDecorationsCollection()
    hovered.current = right.createDecorationsCollection()

    const updated = instance.onDidUpdateDiff(() => live.current.onChanges?.(instance.getLineChanges()?.length ?? 0))
    // Where the caret is, said as which change it is in: scrolling and clicking move the counter
    // the same way the two buttons do.
    const moved = right.onDidChangeCursorPosition((event) => {
      const at = changeAt(instance.getLineChanges(), event.position.lineNumber)
      if (at !== null) live.current.onAt?.(at)
    })

    // The gutter offers a `+` on the line under the pointer, and takes a click on it as the place
    // to write — which is how a forge's diff and VS Code's own comments both behave.
    const moving = right.onMouseMove((event) => {
      const line = event.target.position?.lineNumber
      hovered.current?.set(
        line === undefined || live.current.onCommentOn === undefined
          ? []
          : [{ range: lineRange(line), options: { glyphMarginClassName: WRITE_GLYPH } }],
      )
    })
    const leaving = right.onMouseLeave(() => hovered.current?.set([]))
    // The glyph and the line number both open the composer, which is where a forge's diff and
    // VS Code's own comments each put it.
    const WRITE_ON = [
      monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
      monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS,
    ]
    const down = right.onMouseDown((event) => {
      if (!WRITE_ON.includes(event.target.type)) return
      const line = event.target.position?.lineNumber
      if (line !== undefined) live.current.onCommentOn?.(line)
    })

    return () => {
      for (const off of [updated, moved, moving, leaving, down]) off.dispose()
      instance.dispose()
      models.current?.original.dispose()
      models.current?.modified.dispose()
      models.current = null
      editor.current = null
      glyphs.current = null
      hovered.current = null
      zones.current = []
    }
  }, [])

  // The file in the box. A model per side, keyed by the path, replaced whole when the file changes:
  // a diff has no undo history to keep, so there is nothing to be gained by holding old ones.
  const monacoLanguage = monacoLanguageOf(path, language)
  useEffect(() => {
    const instance = editor.current
    if (instance === null) return
    const made = {
      original: monaco.editor.createModel(original, monacoLanguage, sideUri('original', path)),
      modified: monaco.editor.createModel(modified, monacoLanguage, sideUri('modified', path)),
    }
    const previous = models.current
    models.current = made
    instance.setModel(made)
    previous?.original.dispose()
    previous?.modified.dispose()
  }, [path, monacoLanguage, original, modified])

  useEffect(() => {
    editor.current?.updateOptions({ renderSideBySide: layout === 'split' })
  }, [layout])

  // The lines with something said about them: a glyph beside each, and a mark in the overview
  // ruler so a file taller than the window still says where the talk is.
  useEffect(() => {
    glyphs.current?.set([
      ...marksOn(marks ?? [], 'modified', 'comment').map((line) => ({
        range: lineRange(line),
        options: { glyphMarginClassName: COMMENT_GLYPH, overviewRuler: { color: '#6d7d94', position: RULER } },
      })),
      ...marksOn(marks ?? [], 'modified', 'finding').map((line) => ({
        range: lineRange(line),
        options: { glyphMarginClassName: FINDING_GLYPH, overviewRuler: { color: '#d8a43a', position: RULER } },
      })),
    ])
  }, [marks])

  /*
   * The comment threads, the review threads and the findings, under their lines — the same
   * mechanism VS Code draws its own comments with, split in two (T244). Monaco makes the room: a
   * view zone under the line, holding an empty box. React draws the thread in {@link LAYER}
   * instead, where it is as wide as the whole diff rather than as wide as one pane, and Monaco
   * moves it to the zone's own top on every render it does. The observer below tells Monaco how
   * tall what React drew turned out to be, which is the only way a zone can hold something of
   * unknown height.
   */
  const placed = overlaysOn(overlays ?? [], 'modified')
  const key = placed.map((one) => `${one.id}@${one.line}`).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the set of zones by id and line, which is exactly when they are rebuilt; `placed` is a new array on every render.
  useEffect(() => {
    const instance = editor.current
    // `!`: the effect runs after the commit, so the layer React just drew is there.
    const floor = layer.current!
    if (instance === null) return
    const right = instance.getModifiedEditor()
    const made: Zone[] = []
    right.changeViewZones((accessor) => {
      for (const zone of zones.current) accessor.removeZone(zone.id)
      for (const overlay of placed) {
        const box = document.createElement('div')
        box.style.position = 'absolute'
        box.style.left = '0'
        box.style.top = `${OFFSCREEN}px`
        box.style.pointerEvents = 'auto'
        floor.append(box)
        // Monaco sizes this from `heightInPx` and nothing is ever drawn in it: it is the hole in
        // the code that `box` is laid over, and its height is what keeps the two the same size.
        const domNode = document.createElement('div')
        const view: monaco.editor.IViewZone = {
          afterLineNumber: overlay.line,
          heightInPx: 0,
          domNode,
          // Monaco's own answer to where the zone ended up, scrolling and folding taken in: a line
          // scrolled out of sight is given a top far off the page, which parks the thread with it.
          onDomNodeTop: (top) => {
            box.style.top = `${top}px`
          },
        }
        made.push({ overlay, id: accessor.addZone(view), view, box })
      }
    })
    zones.current = made
    setDrawn(made)

    /*
     * How wide a thread is: from the left edge of the diff to the right edge of the head side's
     * code. In side-by-side that spans both panes and the sash between them, which is the whole
     * point; in inline it is the one column. The scrollbar and the diff's overview ruler are what
     * is left over on the right, so a thread never sits on top of either.
     */
    const spanDiff = () => {
      const node = right.getDomNode()
      if (node === null) return
      const info = right.getLayoutInfo()
      const offset = node.getBoundingClientRect().left - floor.getBoundingClientRect().left
      for (const zone of made) zone.box.style.width = `${Math.max(offset + info.contentLeft + info.contentWidth, 0)}px`
    }
    spanDiff()

    // A zone holds something of unknown height, so its height is measured rather than declared: the
    // observer fires once React has drawn the thread, and every time a reply makes it taller.
    const observer = new ResizeObserver(() => {
      const moved = made.filter((zone) => zone.view.heightInPx !== zone.box.offsetHeight)
      if (moved.length === 0) return
      right.changeViewZones((accessor) => {
        for (const zone of moved) {
          zone.view.heightInPx = zone.box.offsetHeight
          accessor.layoutZone(zone.id)
        }
      })
    })
    for (const zone of made) observer.observe(zone.box)
    // A pane that is resized — the window, or the side-by-side toggle — is a new width to span.
    const relaid = right.onDidLayoutChange(spanDiff)
    return () => {
      relaid.dispose()
      observer.disconnect()
      right.changeViewZones((accessor) => {
        for (const zone of made) accessor.removeZone(zone.id)
      })
      for (const zone of made) zone.box.remove()
      zones.current = []
    }
  }, [key])

  // The change the control bar asked for, revealed. `goTo.seq` moves on every press, so asking for
  // the same change twice still moves the boss there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sequence is what a press is; the change number alone repeats.
  useEffect(() => {
    const instance = editor.current
    if (instance === null || goTo === undefined || goTo.seq === 0) return
    const changes = instance.getLineChanges() ?? []
    const change = changes[goTo.change - 1]
    if (change === undefined) return
    const right = instance.getModifiedEditor()
    // A change that only deletes has no head line of its own; `modifiedStartLineNumber` is then the
    // line it happened after, which is where the boss should be looking.
    const line = Math.max(change.modifiedStartLineNumber, 1)
    right.revealLineInCenter(line)
    right.setPosition({ lineNumber: line, column: 1 })
    live.current.onAt?.(goTo.change)
  }, [goTo?.seq])

  // The line something elsewhere asked for — `Jump to open thread` — scrolled to. `revealLineInCenter`
  // is also what unfolds an unchanged stretch the thread happens to sit inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sequence is what an ask is; the same line asked for twice must still move the boss.
  useEffect(() => {
    if (reveal === undefined || reveal.seq === 0) return
    editor.current?.getModifiedEditor().revealLineInCenter(Math.max(reveal.line, 1))
  }, [reveal?.seq])

  return (
    <div className={COLUMN}>
      <div ref={host} className={HOST} />
      <div ref={layer} className={LAYER} />
      {children !== undefined && drawn.map((zone) => createPortal(children(zone.overlay), zone.box, zone.overlay.id))}
    </div>
  )
}

/** The whole of one line, which is what every decoration here is about. */
function lineRange(line: number): monaco.IRange {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }
}

/** A side's model URI. The scheme keeps the file editor's own providers out of the diff. */
function sideUri(side: string, path: string): monaco.Uri {
  return monaco.Uri.from({ scheme: DIFF_SCHEME, path: `/${side}/${path}` })
}

/** Which change (1-based) a line of the head file is in or after; null before the first one. */
function changeAt(changes: monaco.editor.ILineChange[] | null, line: number): number | null {
  if (changes === null || changes.length === 0) return null
  let at = 0
  for (const [index, change] of changes.entries()) {
    if (change.modifiedStartLineNumber <= line) at = index + 1
  }
  return at === 0 ? 1 : at
}
