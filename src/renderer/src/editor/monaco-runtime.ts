/**
 * The two things every Monaco box in this app shares (T243): the designed code line, and the two
 * themes registered off the live document.
 *
 * It sits beside `monaco.ts` on the lazy chunk, so naming it pulls the editor in — which is why
 * only `CodeMonaco` and `DiffMonaco` do. Everything decided *about* a theme is still plain data in
 * `monaco-theme.ts`, which is what the tests read.
 */
import { monaco } from './monaco'
import { type Appearance, CODE_THEMES, codeTheme } from './monaco-theme'

/** The designed code line: 12.5px JetBrains Mono on 20px, the step the frames draw (`ZNpqJ`). */
export const FONT_SIZE = 12.5
export const LINE_HEIGHT = 20
export const FONT_FAMILY = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace'

/** Which of the two themes a box in this part of the document takes. */
export function appearanceOf(element: Element): Appearance {
  return element.closest('[data-theme]')?.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

/**
 * Registers both themes off the live document, once per load. Each is read inside a box declaring
 * its own appearance, so the Light theme is the Light values even while the app itself is Dark.
 */
let defined = false
export function defineThemes(inside: HTMLElement): void {
  if (defined) return
  defined = true
  for (const appearance of ['dark', 'light'] as const) {
    const probe = document.createElement('div')
    probe.dataset['theme'] = appearance
    probe.style.display = 'none'
    inside.append(probe)
    const style = getComputedStyle(probe)
    monaco.editor.defineTheme(
      CODE_THEMES[appearance],
      codeTheme((name) => style.getPropertyValue(name), appearance),
    )
    probe.remove()
  }
}
