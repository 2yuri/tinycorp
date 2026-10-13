import { useEffect, useRef } from 'react'
import type { CodeSpot, Defined, Severity } from '../../../shared/files/language'
import type { CodeEditorProps, CodeServer } from './CodeEditor'
import { monaco } from './monaco'
import {
  CODE_SCHEME,
  codeFileOf,
  codeUriOf,
  hoverMarkdown,
  lineSpan,
  markersOf,
  monacoLanguageOf,
  spanOf,
  worstByLine,
} from './monaco-model'
import { appearanceOf, defineThemes, FONT_FAMILY, FONT_SIZE, LINE_HEIGHT } from './monaco-runtime'
import { CODE_THEMES } from './monaco-theme'
import '../ui/tailwind.css'

/**
 * The Files view drawn in Monaco (T222) — VS Code's own editor, and the one the boss compared ours
 * with. Everything the app had before is wired onto it rather than around it: the file's own
 * colours from our tokens, the lines the Employee changed striped down the gutter, what the
 * language server complains about as squiggles and gutter marks, its type card as Monaco's hover,
 * and go-to-definition as a real definition provider whose destination the Files view opens as a
 * tab of its own (T121).
 *
 * One editor, many models: a model per file the boss opens, keyed by its URI, so switching tabs
 * keeps a tab's undo history and the place it was scrolled to. They all go when the view does.
 *
 * Nothing in here is drawn by React — Monaco owns the box — so every prop reaches it through an
 * effect, and the callbacks reach it through a ref, so an editor is never torn down to be told a
 * new `onSave`.
 */

/* The box Monaco fills, inside the frame `CodeEditor.tsx` draws. The editor owns everything in it:
   its own ground, its own scrollbars, its own gutter and its own overview ruler. */
const HOST = 'min-h-0 w-full flex-1'

/*
 * **A decoration's class list may hold letters, digits, `-` and `_` and nothing else.** Monaco runs
 * every one of them through `cleanClassName`, which replaces every other character with a space —
 * so `bg-[color-mix(…)]`, `bg-brand-warning/10` and every other arbitrary or modified utility
 * arrives as a handful of fragments that match no rule at all. A wash is therefore a solid token
 * colour and an `opacity-*` beside it, on an element that holds nothing but that colour.
 */

/* The lines the Employee changed: the 10% amber wash the viewer has always drawn behind them. */
const CHANGED_LINE = 'bg-brand-warning opacity-10'

/* The line a path written elsewhere named (T114): where the click meant to land. */
const MARKED_LINE = 'bg-status-info-foreground opacity-20'

/*
 * The severity gutter, beside the line number: VS Code's own three glyphs, in this app's three
 * tones. Monaco puts `codicon` on the element itself and its icon rules are injected at runtime, so
 * naming the icon is all this has to do.
 */
const GLYPH: Record<Severity, string> = {
  error: 'codicon-error text-brand-danger',
  warning: 'codicon-warning text-brand-warning',
  info: 'codicon-info text-status-info-foreground',
}

/** A spot as this app numbers one, from a Monaco position. */
function spotAt(position: { lineNumber: number; column: number }): CodeSpot {
  return { line: position.lineNumber, column: position.column }
}

export function CodeMonaco({
  text,
  path,
  placeId = null,
  language = null,
  readOnly = false,
  changedLines,
  markedLine = null,
  diagnostics,
  server,
  onChange,
  onSave,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const models = useRef(new Map<string, monaco.editor.ITextModel>())
  const marks = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  /** The latest of everything the editor calls back into, so it is built once and told the rest. */
  const live = useRef<{
    server: CodeServer | undefined
    onChange: ((text: string) => void) | undefined
    onSave: (() => void) | undefined
  }>({ server, onChange, onSave })
  live.current = { server, onChange, onSave }

  // The editor itself, built once. Monaco owns everything inside the box from here on.
  useEffect(() => {
    // `!`: the effect runs after the commit, so the box React just drew is there.
    const element = host.current!
    defineThemes(element)
    const instance = monaco.editor.create(element, {
      // No model of its own: the effect below hands it the file's, keyed by place and path. Left
      // out, Monaco makes an untitled one nothing would ever dispose.
      model: null,
      theme: CODE_THEMES[appearanceOf(element)],
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      automaticLayout: true,
      minimap: { enabled: false },
      glyphMargin: true,
      lineDecorationsWidth: 8,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      padding: { top: 12, bottom: 12 },
      tabSize: 2,
      // The colours are this app's seven tokens; bracket pairs would add six nobody named.
      bracketPairColorization: { enabled: false },
      guides: { bracketPairs: false },
      stickyScroll: { enabled: false },
      overviewRulerBorder: false,
      scrollbar: { useShadows: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      fixedOverflowWidgets: true,
      // A worktree is somebody else's code: suggesting words out of it while the boss types in
      // another file is noise, and there is no language service behind it to suggest anything real.
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
    })
    editor.current = instance
    marks.current = instance.createDecorationsCollection()

    // ⌘S on a Mac, Ctrl+S everywhere else: `CtrlCmd` is the one Monaco resolves per platform, and
    // it is the same key the header's own button says it is (`shortcutLabel`).
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => live.current.onSave?.())
    const typed = instance.onDidChangeModelContent(() => {
      const model = instance.getModel()
      if (model !== null) live.current.onChange?.(model.getValue())
    })

    const owned = models.current
    return () => {
      typed.dispose()
      instance.dispose()
      for (const model of owned.values()) model.dispose()
      owned.clear()
      editor.current = null
      marks.current = null
    }
  }, [])

  // What the language server knows (T115), as Monaco's own two providers. Scoped to this app's own
  // scheme, so nothing here ever answers about a model the editor made for something else.
  useEffect(() => {
    const hover = monaco.languages.registerHoverProvider(
      { scheme: CODE_SCHEME },
      {
        provideHover: async (model, position) => {
          const found = await live.current.server?.hover(spotAt(position))
          if (found === undefined || found === null || model.isDisposed()) return null
          return { range: spanOf(found.range), contents: hoverMarkdown(found).map((value) => ({ value })) }
        },
      },
    )
    const definition = monaco.languages.registerDefinitionProvider(
      { scheme: CODE_SCHEME },
      {
        provideDefinition: async (_model, position) => {
          const found = await live.current.server?.definition(spotAt(position))
          if (found === undefined || found === null) return null
          return [{ uri: monaco.Uri.from(codeUriOf(found.placeId, found.path)), range: lineSpan(found.line) }]
        },
      },
    )
    // ⌘-click, F12 and a peek's Open all end here, for a declaration in another file: the Files
    // view opens it as a tab of its own rather than Monaco replacing what the boss is reading.
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, at) => {
        if (resource.scheme !== CODE_SCHEME) return false
        const file = codeFileOf({ scheme: resource.scheme, path: resource.path, query: resource.query })
        const line = at === undefined ? 1 : 'startLineNumber' in at ? at.startLineNumber : at.lineNumber
        const column = at === undefined ? 1 : 'startColumn' in at ? at.startColumn : at.column
        const going: Defined = { ...file, line, column }
        live.current.server?.open(going)
        return true
      },
    })
    return () => {
      hover.dispose()
      definition.dispose()
      opener.dispose()
    }
  }, [])

  // The file in the box. A tab the boss comes back to finds its own model, with its undo history
  // and the place it was scrolled to still in it.
  const key = `${placeId ?? ''}:${path}`
  const monacoLanguage = monacoLanguageOf(path, language)
  useEffect(() => {
    const instance = editor.current
    if (instance === null) return
    const uri = monaco.Uri.from(codeUriOf(placeId, path))
    let model = models.current.get(key)
    if (model === undefined || model.isDisposed()) {
      model = monaco.editor.getModel(uri) ?? monaco.editor.createModel('', monacoLanguage, uri)
      models.current.set(key, model)
    }
    monaco.editor.setModelLanguage(model, monacoLanguage)
    if (instance.getModel() !== model) instance.setModel(model)
  }, [key, path, placeId, monacoLanguage])

  // The text, whenever it did not come from the box itself: a save, a discard, a conflict taken
  // the other way, or the file being read again. `setValue` only when it really differs, or every
  // keystroke would go back in and take the caret with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the model this is about — a tab switched to a file with the same text still has a model to fill.
  useEffect(() => {
    const model = editor.current?.getModel()
    if (model !== null && model !== undefined && model.getValue() !== text) model.setValue(text)
  }, [text, key])

  useEffect(() => {
    editor.current?.updateOptions({ readOnly, domReadOnly: readOnly })
  }, [readOnly])

  // What the server complains about: the squiggle, the mark in the overview ruler, and — because
  // the viewer has always had one — a mark in the gutter for the worst thing said about a line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the model the markers go on, and a new model carries none.
  useEffect(() => {
    const model = editor.current?.getModel()
    if (model === null || model === undefined) return
    monaco.editor.setModelMarkers(model, CODE_SCHEME, markersOf(diagnostics ?? []))
  }, [diagnostics, key])

  // The gutter and the two tints: the Employee's changed lines, and the line a link asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the model the decorations go on, and a new model carries none.
  useEffect(() => {
    const collection = marks.current
    if (collection === null) return
    const worst = worstByLine(diagnostics ?? [])
    collection.set([
      ...(changedLines ?? []).map((line) => ({
        range: lineSpan(line),
        options: { isWholeLine: true, className: CHANGED_LINE },
      })),
      ...[...worst].map(([line, severity]) => ({
        range: lineSpan(line),
        options: { isWholeLine: true, glyphMarginClassName: GLYPH[severity] },
      })),
      ...(markedLine === null
        ? []
        : [{ range: lineSpan(markedLine), options: { isWholeLine: true, className: MARKED_LINE } }]),
    ])
  }, [changedLines, diagnostics, markedLine, key])

  // The line a path written elsewhere named (T114), scrolled to — and only when it is a new one.
  // Scrolling belongs to the boss from then on: a diagnostic arriving is no reason to move them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the file, so the same line of a different file is a different landing.
  useEffect(() => {
    if (markedLine !== null) editor.current?.revealLineInCenter(markedLine)
  }, [markedLine, key])

  return <div ref={host} className={HOST} />
}
