/**
 * Monaco — VS Code's own editor — as this app takes it (T222).
 *
 * **Composed rather than imported whole.** `import 'monaco-editor'` is the editor, every language's
 * colours **and** the four language services (TypeScript, JSON, CSS, HTML), each of which spawns a
 * worker of its own; the TypeScript one alone is megabytes, and it would sit beside the real
 * language server the main process already runs (T115) answering the same questions worse. So the
 * three pieces are named one at a time: the editor's own contributions, the Monarch grammars for
 * every language a repo holds, and the API. Nothing else.
 *
 * **The worker is inlined on purpose.** Chromium will not start a worker from a `file:` URL, which
 * is what a packaged renderer is served over, so Vite's `?worker&inline` is what makes the editor
 * work in the app at all: the worker's code rides in this chunk and is started from a `blob:` URL.
 * That is the one thing `worker-src 'self' blob:` in `main/app/window-policy.ts` is there for, and
 * it is why nothing is ever fetched: no CDN, no `loader.js`, no network at runtime.
 *
 * This module is only ever reached through `CodeEditor.tsx`'s lazy import, so none of it is in the
 * startup bundle — the same way xterm and Pixi arrive (T211).
 */
import 'monaco-editor/features/register.all'
import 'monaco-editor/languages/definitions/register.all'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline'

/** The only worker the composed editor asks for: diffing, links and word suggestions run in it. */
globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export { monaco }
