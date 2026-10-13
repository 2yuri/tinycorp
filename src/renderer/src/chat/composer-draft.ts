import { useEffect, useRef } from 'react'
import type { AttachmentSource } from '../../../shared/attachments'
import { type Draft, type DraftKey, isEmptyDraft } from '../../../shared/drafts'
import type { PendingAttachment } from './Attachments'

/** How long the box stays still before what it holds is kept. */
export const DRAFT_SAVE_DELAY = 400

/** Where a picked or dropped file is on disk; empty when it has none, like a pasted image. */
export function pathOf(file: File): string {
  try {
    return window.tinyCorp.chat?.pathOf?.(file) ?? ''
  } catch {
    return ''
  }
}

/** What a composer holds, as a draft keeps it: a file with no path on disk cannot be kept. */
export function draftOf(text: string, attached: readonly PendingAttachment[]): Draft {
  return {
    text,
    files: attached.flatMap((a) => (a.path ? [{ path: a.path, name: a.name, size: a.size }] : [])),
  }
}

/** A kept draft's files as the composer holds them: by path, with no `File` behind them. */
export function heldFrom(draft: Draft): PendingAttachment[] {
  return draft.files.map((file, i) => ({
    key: `draft-${i}-${file.path}`,
    name: file.name,
    size: file.size,
    path: file.path,
  }))
}

export interface ComposerDraft {
  /** Forgets the draft now, once what it held was sent: the sidebar's pencil goes with it. */
  clear(): void
  /** One held file's name and bytes, for sending: a restored one is read by the main process. */
  source(attachment: PendingAttachment): Promise<AttachmentSource>
}

/**
 * Keeps a composer's text and files under `key` (TI-1): loads them once when the composer mounts,
 * keeps them `DRAFT_SAVE_DELAY` after the last change, and once more when the composer goes or the
 * window closes. Without a key nothing is loaded or kept, as in the review composers.
 *
 * `restore` hands a kept draft back to the composer; it is only called while the boss has typed
 * nothing, so a slow load never overwrites what they started.
 */
export function useComposerDraft(
  key: DraftKey | undefined,
  text: string,
  attached: readonly PendingAttachment[],
  restore: (draft: Draft) => void,
): ComposerDraft {
  const api = window.tinyCorp.chat
  /** What the composer holds now, read by the timer and the unmount flush. */
  const latest = useRef<Draft>(draftOf(text, attached))
  latest.current = draftOf(text, attached)
  /** What the store holds, as JSON, so an unchanged draft is not written again. */
  const kept = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreRef = useRef(restore)
  restoreRef.current = restore

  function flush() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    if (!key) return
    const draft = latest.current
    // An empty box is not an erasure before the kept draft has loaded: it would delete one the boss
    // has not been shown. What they typed in the meantime is theirs, and is kept even then — leaving
    // the moment after opening a conversation is the one way out of here that is not the timer.
    if (kept.current === null && isEmptyDraft(draft)) return
    const json = JSON.stringify(isEmptyDraft(draft) ? null : draft)
    if (json === kept.current) return
    kept.current = json
    void api?.saveDraft?.(key, draft)
  }

  // Loaded once per key. `flush` reads refs only, so it cannot go stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!key) return
    let live = true
    kept.current = null
    void (async () => {
      const result = await api?.draft?.(key)
      if (!live) return
      const draft = result?.ok ? result.value : null
      if (draft && isEmptyDraft(latest.current)) {
        restoreRef.current(draft)
        latest.current = draft
      }
      kept.current = JSON.stringify(draft)
      flush()
    })()
    const leaving = () => flush()
    window.addEventListener('beforeunload', leaving)
    return () => {
      window.removeEventListener('beforeunload', leaving)
      flush()
      live = false
    }
  }, [key])

  // Kept a moment after the last keystroke or file, so typing is not a write per letter. `text` and
  // `attached` are what changed; `flush` reads them from the ref.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!key || kept.current === null) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(flush, DRAFT_SAVE_DELAY)
  }, [key, text, attached])

  return {
    clear() {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      if (!key) return
      kept.current = JSON.stringify(null)
      void api?.clearDraft?.(key)
    },
    async source(attachment) {
      if (attachment.file) return { name: attachment.name, data: new Uint8Array(await attachment.file.arrayBuffer()) }
      if (!key || !attachment.path) throw new Error(`${attachment.name} can no longer be sent`)
      const result = await api?.draftFile?.(key, attachment.path)
      if (!result) throw new Error(`${attachment.name} can no longer be sent`)
      if (!result.ok) throw new Error(result.error)
      return result.value
    },
  }
}
