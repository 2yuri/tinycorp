import {
  BOSS_HANDLE_PATTERN,
  type Boss,
  type BossUpdate,
  defaultBoss,
  handleFrom,
  isBossStatus,
  spriteIndex,
} from '../../../shared/boss-profile'
import { BOSS_INITIALS_PATTERN, initialsFrom } from '../../../shared/company'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import { isTerminalRightClick } from '../../../shared/platform/terminal-right-click'
import { parseRuntimeKey } from '../../../shared/platform/wsl'

/**
 * Where the one boss profile is kept. In the app it is a JSON file beside `recent-companies.json`
 * in `userData` (`boss-profile-file.ts`); tests keep it in memory.
 */
export interface BossProfileStore {
  /** The stored profile, or null while nothing has been written yet. */
  read(): Partial<Boss> | null
  write(profile: Boss): void
}

/** The boss's profile, shared by every Company. */
export interface BossProfiles {
  get(): Boss
  update(update: BossUpdate): Boss
  /**
   * Seeds the profile from a Company's own `boss_name` / `boss_initials`, the fields Companies
   * carried before T79. Does nothing once a profile is stored, so it never undoes an edit.
   */
  adopt(fields: { name?: string | null; initials?: string | null }): void
  /** Called after the profile changes. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
}

/** What a partly written or hand-edited file leaves out, filled from the OS account name. */
export function normaliseBoss(stored: Partial<Boss> | null, defaultName: string): Boss {
  const base = defaultBoss(defaultName)
  if (!stored) return base
  const name = text(stored.name) || base.name
  return {
    name,
    handle: text(stored.handle) || handleFrom(name),
    initials: text(stored.initials) || initialsFrom(name),
    email: text(stored.email),
    sprite: typeof stored.sprite === 'number' ? spriteIndex(stored.sprite) : base.sprite,
    status: isBossStatus(stored.status) ? stored.status : base.status,
    statusUntil: typeof stored.statusUntil === 'number' ? stored.statusUntil : null,
    sound: stored.sound === true,
    providerRuntimes: runtimePicks(stored.providerRuntimes),
    // A default naming nothing — a hand-edited file, a build that spelled it differently — is the
    // same as never having answered: the Providers fall back on where they were found.
    defaultRuntime: parseRuntimeKey(stored.defaultRuntime) ? (stored.defaultRuntime as string) : null,
    rightClick: isTerminalRightClick(stored.rightClick) ? stored.rightClick : null,
    windowsSetupDone: stored.windowsSetupDone === true,
  }
}

/**
 * The stored runtime picks, keeping only the entries that name a place (T167). A hand-edited file,
 * or one written by a build that spelled them differently, loses the entries that mean nothing
 * rather than the whole profile.
 */
function runtimePicks(stored: unknown): Record<string, string> {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return {}
  return Object.fromEntries(
    Object.entries(stored as Record<string, unknown>).flatMap(([provider, key]) =>
      parseRuntimeKey(key) ? [[provider, key as string]] : [],
    ),
  )
}

/**
 * The profile with an update applied, after checking all of it: nothing changes when one field is
 * wrong, exactly as Company settings applies its own.
 */
export function applyBossUpdate(current: Boss, update: BossUpdate): Boss {
  const next: Boss = { ...current }
  if (update.name !== undefined) {
    const name = update.name.trim()
    if (!name) throw new Error('The boss needs a name')
    next.name = name
  }
  if (update.handle !== undefined) {
    const handle = update.handle.trim().replace(/^@/, '').toLowerCase()
    if (!BOSS_HANDLE_PATTERN.test(handle)) {
      throw new Error('A handle is 1 to 30 lower-case letters, digits, dot, dash or underscore')
    }
    next.handle = handle
  }
  if (update.handle === undefined && update.name !== undefined && current.handle === handleFrom(current.name)) {
    // A handle the boss never set by hand follows the name, as the initials do.
    next.handle = handleFrom(next.name)
  }
  if (update.initials !== undefined) {
    const initials = update.initials.trim().toUpperCase()
    if (initials && !BOSS_INITIALS_PATTERN.test(initials)) {
      throw new Error('Initials are 1 to 3 letters or digits')
    }
    // Blank follows the name, as Company settings' initials field does.
    next.initials = initials || initialsFrom(next.name)
  } else if (update.name !== undefined && current.initials === initialsFrom(current.name)) {
    next.initials = initialsFrom(next.name)
  }
  if (update.sprite !== undefined) {
    if (!Number.isInteger(update.sprite) || update.sprite < 0 || update.sprite >= CHARACTER_SHEETS) {
      throw new Error(`A sprite is one of the ${CHARACTER_SHEETS} characters`)
    }
    next.sprite = update.sprite
  }
  if (update.status !== undefined) {
    if (!isBossStatus(update.status)) throw new Error(`Unknown status: ${String(update.status)}`)
    next.status = update.status
  }
  if (update.statusUntil !== undefined) {
    if (update.statusUntil !== null && !Number.isFinite(update.statusUntil)) {
      throw new Error('A status clears at a time or never')
    }
    next.statusUntil = update.statusUntil
  }
  if (update.sound !== undefined) next.sound = update.sound
  if (update.defaultRuntime !== undefined) {
    if (update.defaultRuntime !== null && !parseRuntimeKey(update.defaultRuntime)) {
      throw new Error(`${update.defaultRuntime} is not a place a Provider can run`)
    }
    next.defaultRuntime = update.defaultRuntime
  }
  if (update.rightClick !== undefined) {
    if (update.rightClick !== null && !isTerminalRightClick(update.rightClick)) {
      throw new Error(`${String(update.rightClick)} is not what a right-click can do`)
    }
    next.rightClick = update.rightClick
  }
  if (update.windowsSetupDone !== undefined) next.windowsSetupDone = update.windowsSetupDone
  if (update.providerRuntimes !== undefined) {
    const picks: Record<string, string> = { ...current.providerRuntimes }
    for (const [provider, key] of Object.entries(update.providerRuntimes)) {
      if (!parseRuntimeKey(key)) throw new Error(`${key} is not a place a Provider can run`)
      picks[provider] = key
    }
    next.providerRuntimes = picks
  }
  return next
}

export interface BossProfilesOptions {
  store: BossProfileStore
  /** The boss's name until they set one, e.g. the OS account's. */
  defaultName?: () => string
  /**
   * The boss fields already stored per Company (the recents file), read once when nothing has been
   * written yet: the profile carries over instead of starting from the OS account name.
   */
  storedCompanies?: () => { name?: string | null; initials?: string | null }[]
  /** The clock a status's expiry is measured against. Defaults to `Date.now`. */
  now?: () => number
}

/** The boss profile service the engine exposes: read, write, and the one-time migration. */
export function createBossProfiles({
  store,
  defaultName = () => 'Boss',
  storedCompanies = () => [],
  now = Date.now,
}: BossProfilesOptions): BossProfiles {
  const listeners = new Set<() => void>()
  let cached: Boss | null = null
  // Migration is a one-time affair: a profile that already exists, or one the boss has edited or
  // carried over once, is never overwritten by another Company's old boss fields.
  let settled = store.read() !== null

  function fallbackName(): string {
    return defaultName().trim() || 'Boss'
  }

  /** The stored profile, migrating the per-Company boss fields the first time there is none. */
  function load(): Boss {
    if (cached) return cached
    const stored = store.read()
    if (stored) {
      cached = normaliseBoss(stored, fallbackName())
      return cached
    }
    const carried = storedCompanies().find((c) => text(c.name))
    const profile = normaliseBoss(
      carried ? { name: text(carried.name), initials: text(carried.initials) } : null,
      fallbackName(),
    )
    store.write(profile)
    cached = profile
    return cached
  }

  function save(profile: Boss): Boss {
    cached = profile
    store.write(profile)
    for (const listener of listeners) listener()
    return profile
  }

  /** The profile as it stands now: a status whose duration has run out is already back to Available. */
  function read(): Boss {
    const profile = load()
    if (profile.statusUntil === null || profile.statusUntil > now()) return profile
    return save({ ...profile, status: 'available', statusUntil: null })
  }

  return {
    get: read,
    update(update) {
      settled = true
      return save(applyBossUpdate(read(), update))
    },
    adopt(fields) {
      if (settled) return
      const name = text(fields.name)
      if (!name) return
      settled = true
      save(normaliseBoss({ name, initials: text(fields.initials) }, fallbackName()))
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
