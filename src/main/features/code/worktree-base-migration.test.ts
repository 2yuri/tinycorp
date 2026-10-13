import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { WORKTREE_BASE_FOLLOWS_TICKET_MIGRATION } from './code-flow'

describe('worktree-base-follows-ticket (T286)', () => {
  it('puts every worktree on its ticket’s base, and leaves one whose ticket names none', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      CREATE TABLE ticket (id INTEGER PRIMARY KEY, base_branch TEXT);
      CREATE TABLE worktree (ticket_id INTEGER, repo_id TEXT, base TEXT);
      INSERT INTO ticket VALUES (15, 'develop'), (16, NULL), (17, 'main');
      INSERT INTO worktree VALUES (15, 'web', 'main'), (15, 'api', 'main'), (16, 'web', 'main'), (17, 'web', 'main');
    `)

    db.exec(WORKTREE_BASE_FOLLOWS_TICKET_MIGRATION.sql)

    expect(db.prepare('SELECT ticket_id, repo_id, base FROM worktree ORDER BY ticket_id, repo_id').all()).toEqual([
      { ticket_id: 15, repo_id: 'api', base: 'develop' },
      { ticket_id: 15, repo_id: 'web', base: 'develop' },
      { ticket_id: 16, repo_id: 'web', base: 'main' },
      { ticket_id: 17, repo_id: 'web', base: 'main' },
    ])
  })
})
