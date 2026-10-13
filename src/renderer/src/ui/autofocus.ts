/**
 * Focus a field the moment it mounts — the box a modal opens on, the input an inline editor puts
 * where a chip was.
 *
 * It is `ref={focusOnMount}`, not `autoFocus`: the HTML attribute fires when the *document* loads
 * and moves the caret out from under whoever is already reading the page, which is why
 * `a11y/noAutofocus` bans it. A field that appears because the boss just opened it is the other
 * case, and a mount is when it appears. The function is a module constant so React calls it once,
 * when the node arrives, and never again on a re-render.
 */
export function focusOnMount(node: HTMLElement | null): void {
  node?.focus()
}
