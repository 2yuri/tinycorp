import type { DatabaseSync } from 'node:sqlite'
import type { Provider } from '../../../shared/domain/staff'
import {
  DEFAULT_USAGE_ROUTING,
  type EmployeeRouting,
  FOLLOWS_COMPANY,
  followsCompany,
  type OutOfProviderRule,
  type UsageRouting,
} from '../../../shared/usage/usage-routing'
import type { Migration } from '../../core'

/**
 * The Company's answer to "when a provider runs out" (T173, frame `bB6VX`), and the Employees that
 * do not follow it.
 *
 * One row per Provider the boss has said something about, one settings row for the two toggles and
 * rotation, and one row per Employee that overrides the Company. A Provider with no row waits, and
 * an Employee with no row follows the Company: nothing here is written until the boss changes it.
 */
export const USAGE_ROUTING_MIGRATION: Migration = {
  name: 'usage-routing-rules-and-employee-overrides',
  sql: `
  CREATE TABLE usage_routing (
    provider TEXT PRIMARY KEY,
    rule TEXT NOT NULL,
    fallback_provider TEXT,
    fallback_model TEXT,
    move_back INTEGER NOT NULL DEFAULT 1,
    pinned_account TEXT
  );
  CREATE TABLE usage_routing_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    resume_at_reset INTEGER NOT NULL,
    rotate_accounts INTEGER NOT NULL
  );
  CREATE TABLE employee_routing (
    employee_id TEXT PRIMARY KEY REFERENCES employee (id),
    rule TEXT,
    fallback_provider TEXT,
    fallback_model TEXT,
    pinned_accounts TEXT NOT NULL DEFAULT '{}'
  );
`,
}

/** What Company settings reads and writes on the Usage & routing tab. */
export interface UsageRoutingStore {
  /** The Company's rule for every Provider, and the toggles that go with it. */
  get(): UsageRouting
  /** Replaces the rule for one Provider. */
  setRule(provider: Provider, rule: OutOfProviderRule): UsageRouting
  setMoveBack(provider: Provider, on: boolean): UsageRouting
  setResumeAtReset(on: boolean): UsageRouting
  /** Turning rotation on is the boss's call, made after reading the warning (frame `bB6VX`). */
  setRotateAccounts(on: boolean): UsageRouting
  /** Pins every Employee of this Company to one account of a Provider; null is "first with room left". */
  setPinnedAccount(provider: Provider, accountId: string | null): UsageRouting
  /** One Employee's own answer, or {@link FOLLOWS_COMPANY} when it has none. */
  employee(employeeId: string): EmployeeRouting
  /** Every Employee that does not follow the Company, in the order they were hired. */
  overrides(): { employeeId: string; routing: EmployeeRouting }[]
  setEmployeeRule(employeeId: string, rule: OutOfProviderRule | null): EmployeeRouting
  setEmployeePin(employeeId: string, provider: Provider, accountId: string | null): EmployeeRouting
  /** Drops an Employee's override, so it follows the Company again. */
  clearEmployee(employeeId: string): void
}

/** Reads and writes one Company's routing rules. `db` is read on every call, never captured. */
export function createUsageRouting(db: () => DatabaseSync): UsageRoutingStore {
  interface RuleRow {
    provider: string
    rule: string
    fallback_provider: string | null
    fallback_model: string | null
    move_back: number
    pinned_account: string | null
  }
  interface SettingRow {
    resume_at_reset: number
    rotate_accounts: number
  }
  interface EmployeeRow {
    employee_id: string
    rule: string | null
    fallback_provider: string | null
    fallback_model: string | null
    pinned_accounts: string
  }

  function read(): UsageRouting {
    const rows = db().prepare('SELECT * FROM usage_routing').all() as unknown as RuleRow[]
    const setting = db().prepare('SELECT * FROM usage_routing_setting WHERE id = 1').get() as SettingRow | undefined
    const routing: UsageRouting = {
      rules: {},
      moveBack: {},
      resumeAtReset: setting ? setting.resume_at_reset === 1 : DEFAULT_USAGE_ROUTING.resumeAtReset,
      rotateAccounts: setting ? setting.rotate_accounts === 1 : DEFAULT_USAGE_ROUTING.rotateAccounts,
      pinnedAccount: {},
    }
    for (const row of rows) {
      routing.rules[row.provider] =
        row.rule === 'continue' && row.fallback_provider
          ? { kind: 'continue', provider: row.fallback_provider as Provider, model: row.fallback_model }
          : { kind: 'wait' }
      routing.moveBack[row.provider] = row.move_back === 1
      if (row.pinned_account) routing.pinnedAccount[row.provider] = row.pinned_account
    }
    return routing
  }

  /** Writes the Provider's row, keeping whatever the other columns already held. */
  function upsert(provider: string, change: Partial<Omit<RuleRow, 'provider'>>): UsageRouting {
    const current = (db().prepare('SELECT * FROM usage_routing WHERE provider = ?').get(provider) ?? {
      provider,
      rule: 'wait',
      fallback_provider: null,
      fallback_model: null,
      move_back: 1,
      pinned_account: null,
    }) as unknown as RuleRow
    const next = { ...current, ...change }
    db()
      .prepare(
        `INSERT INTO usage_routing (provider, rule, fallback_provider, fallback_model, move_back, pinned_account)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider) DO UPDATE SET rule = excluded.rule,
           fallback_provider = excluded.fallback_provider, fallback_model = excluded.fallback_model,
           move_back = excluded.move_back, pinned_account = excluded.pinned_account`,
      )
      .run(provider, next.rule, next.fallback_provider, next.fallback_model, next.move_back, next.pinned_account)
    return read()
  }

  function setting(change: Partial<SettingRow>): UsageRouting {
    const current = read()
    const next = {
      resume_at_reset: change.resume_at_reset ?? (current.resumeAtReset ? 1 : 0),
      rotate_accounts: change.rotate_accounts ?? (current.rotateAccounts ? 1 : 0),
    }
    db()
      .prepare(
        `INSERT INTO usage_routing_setting (id, resume_at_reset, rotate_accounts) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET resume_at_reset = excluded.resume_at_reset,
           rotate_accounts = excluded.rotate_accounts`,
      )
      .run(next.resume_at_reset, next.rotate_accounts)
    return read()
  }

  function toEmployeeRouting(row: EmployeeRow | undefined): EmployeeRouting {
    if (!row) return FOLLOWS_COMPANY
    const rule: OutOfProviderRule | null =
      row.rule === 'continue' && row.fallback_provider
        ? { kind: 'continue', provider: row.fallback_provider as Provider, model: row.fallback_model }
        : row.rule === 'wait'
          ? { kind: 'wait' }
          : null
    let pinnedAccount: Record<string, string> = {}
    try {
      const parsed: unknown = JSON.parse(row.pinned_accounts)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        pinnedAccount = parsed as Record<string, string>
      }
    } catch {
      // A row nobody can parse is a row that says nothing: the Employee follows its Company.
    }
    return { rule, pinnedAccount }
  }

  function employeeRow(employeeId: string): EmployeeRow | undefined {
    return db().prepare('SELECT * FROM employee_routing WHERE employee_id = ?').get(employeeId) as
      | EmployeeRow
      | undefined
  }

  function writeEmployee(employeeId: string, routing: EmployeeRouting): EmployeeRouting {
    if (followsCompany(routing)) {
      db().prepare('DELETE FROM employee_routing WHERE employee_id = ?').run(employeeId)
      return FOLLOWS_COMPANY
    }
    db()
      .prepare(
        `INSERT INTO employee_routing (employee_id, rule, fallback_provider, fallback_model, pinned_accounts)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (employee_id) DO UPDATE SET rule = excluded.rule,
           fallback_provider = excluded.fallback_provider, fallback_model = excluded.fallback_model,
           pinned_accounts = excluded.pinned_accounts`,
      )
      .run(
        employeeId,
        routing.rule?.kind ?? null,
        routing.rule?.kind === 'continue' ? routing.rule.provider : null,
        routing.rule?.kind === 'continue' ? routing.rule.model : null,
        JSON.stringify(routing.pinnedAccount),
      )
    return toEmployeeRouting(employeeRow(employeeId))
  }

  return {
    get: read,

    setRule(provider, rule) {
      return upsert(provider, {
        rule: rule.kind,
        fallback_provider: rule.kind === 'continue' ? rule.provider : null,
        fallback_model: rule.kind === 'continue' ? rule.model : null,
      })
    },

    setMoveBack: (provider, on) => upsert(provider, { move_back: on ? 1 : 0 }),

    setResumeAtReset: (on) => setting({ resume_at_reset: on ? 1 : 0 }),

    setRotateAccounts: (on) => setting({ rotate_accounts: on ? 1 : 0 }),

    setPinnedAccount: (provider, accountId) => upsert(provider, { pinned_account: accountId }),

    employee: (employeeId) => toEmployeeRouting(employeeRow(employeeId)),

    overrides() {
      const rows = db()
        .prepare(
          `SELECT r.* FROM employee_routing r
           JOIN employee e ON e.id = r.employee_id
           WHERE e.fired_at IS NULL
           ORDER BY e.created_at, e.rowid`,
        )
        .all() as unknown as EmployeeRow[]
      return rows.map((row) => ({ employeeId: row.employee_id, routing: toEmployeeRouting(row) }))
    },

    setEmployeeRule(employeeId, rule) {
      const before = toEmployeeRouting(employeeRow(employeeId))
      return writeEmployee(employeeId, { ...before, rule })
    },

    setEmployeePin(employeeId, provider, accountId) {
      const before = toEmployeeRouting(employeeRow(employeeId))
      const pinnedAccount = { ...before.pinnedAccount }
      if (accountId) pinnedAccount[provider] = accountId
      else delete pinnedAccount[provider]
      return writeEmployee(employeeId, { ...before, pinnedAccount })
    },

    clearEmployee(employeeId) {
      db().prepare('DELETE FROM employee_routing WHERE employee_id = ?').run(employeeId)
    },
  }
}
