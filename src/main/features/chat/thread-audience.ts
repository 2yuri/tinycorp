import type { DatabaseSync } from 'node:sqlite'

/** Who a thread belongs to, beyond whoever a single reply in it happens to name (T231). */
export interface ThreadAudience {
  /** Who started the thread: the author of its root message. */
  authorId: string
  /** Everyone `@`-mentioned anywhere in it, in the root or in any reply. */
  mentioned: string[]
}

export interface ThreadAudiences {
  /**
   * The audience of the thread rooted at `threadId`, or null when there is no such message.
   *
   * A reply reaches these people even when its own text names nobody, which is what tells the boss
   * that a thread they started — or one they were pulled into — moved on (T231).
   */
  threadAudience(threadId: number): ThreadAudience | null
}

interface Row {
  id: number
  author_id: string
  mentions: string
}

export function createThreadAudiences(db: DatabaseSync): ThreadAudiences {
  return {
    threadAudience(threadId) {
      const rows = db
        .prepare('SELECT id, author_id, mentions FROM message WHERE id = ? OR thread_id = ? ORDER BY id')
        .all(threadId, threadId) as unknown as Row[]
      const root = rows.find((row) => row.id === threadId)
      if (!root) return null
      const mentioned = new Set<string>()
      for (const row of rows) for (const id of JSON.parse(row.mentions) as string[]) mentioned.add(id)
      return { authorId: root.author_id, mentioned: [...mentioned] }
    },
  }
}
