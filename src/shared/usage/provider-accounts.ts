import type { UsageWindow } from './provider-usage'

/**
 * One sign-in of one Provider (T173, frames `A2lOk0` and `bB6VX`).
 *
 * An account **is** a config directory: Claude Code reads `CLAUDE_CONFIG_DIR`, Codex reads
 * `CODEX_HOME`, and a Session started with one pointed at a directory is signed in as whoever
 * signed in there. TinyCorp never sees or stores the credential — `Add another account` runs the
 * product's own login in a terminal inside that directory, and the product writes it.
 */
export interface ProviderAccount {
  /** Stable id, used by pins and overrides. Never the email. */
  id: string
  provider: string
  /** What the boss calls it: `Personal`, `Work`. */
  label: string
  /** The plan the CLI reports, e.g. `Max 20×`; null until a read says. */
  plan: string | null
  /** The address the CLI reports; null until a read says, and never sent anywhere. */
  email: string | null
  /** The config directory this sign-in lives in. Inside the app's own folder, one per account. */
  configDir: string
  /** The one an Employee takes when nothing pins it and every account has room. */
  isDefault: boolean
  /** True for the account that is the product's own default directory, which cannot be removed. */
  primary: boolean
}

/** An account with the numbers beside it, as the Accounts card and the popover draw one row. */
export interface AccountRow extends ProviderAccount {
  /** The window the row draws its bar from — the shortest one — or null when nothing was read. */
  window: UsageWindow | null
  /** Set while this account is at its limit and has not reset. */
  outOfBudget: boolean
  reason: string | null
}

/** How full an account is, 0-100, or null when nothing was read. A missing read is never a zero. */
export function accountPercent(row: Pick<AccountRow, 'window'>): number | null {
  return row.window ? row.window.percent : null
}

/** The label a first account is given, before the boss renames it. */
export const PRIMARY_ACCOUNT_LABEL = 'Personal'

/** Longest label an account may carry. */
export const ACCOUNT_LABEL_MAX = 24

/** The label as it is stored: trimmed, collapsed and clipped. Empty is refused by the caller. */
export function accountLabel(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, ACCOUNT_LABEL_MAX)
}
