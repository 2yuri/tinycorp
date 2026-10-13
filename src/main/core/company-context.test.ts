import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { Company } from '../../shared/company'
import { type CompanyContext, createCompanyContext, type OpenCompany } from './company-context'
import { onDisk } from './testing'

/**
 * The context every feature is wired against, and the one promise it makes: nothing keyed by a
 * Company outlives that Company.
 *
 * #410 was one cache that was not emptied on close. The fix for one cache is a line in
 * `closeCompany`; the fix for the bug *class* is that no feature keeps a map of its own, so there is
 * no line to forget. These tests are about that — a cache nobody here has heard of is still emptied,
 * because the context is what made it.
 */

function entry(id: string, name = id): OpenCompany {
  const company = {
    id,
    name,
    key: name.slice(0, 2).toUpperCase(),
    folder: onDisk(`/work/${id}`),
    boss: { name: 'Ada', initials: 'A', handle: 'ada', sprite: 'boss', status: 'in' },
  } as unknown as Company
  return { company, db: new DatabaseSync(':memory:') }
}

/** A cache that counts how often it was made and whether it was disposed, like a real one holds. */
function counted(ctx: CompanyContext) {
  const made: string[] = []
  const disposed: string[] = []
  const cache = ctx.perCompany(
    (open) => {
      made.push(open.company.id)
      return { id: open.company.id }
    },
    (value) => disposed.push(value.id),
  )
  return { cache, made, disposed }
}

describe('a per-Company cache', () => {
  it('makes a value once per Company and hands the same one back', () => {
    const ctx = createCompanyContext()
    const { cache, made } = counted(ctx)
    const acme = entry('acme')
    ctx.opened(acme)

    expect(cache.of(acme)).toBe(cache.of(acme))
    expect(cache.ofId('acme')).toBe(cache.of(acme))
    expect(cache.current()).toBe(cache.of(acme))
    expect(made).toEqual(['acme'])
  })

  it('keeps the Companies apart', () => {
    const ctx = createCompanyContext()
    const { cache } = counted(ctx)
    const acme = entry('acme')
    const globex = entry('globex')
    ctx.opened(acme)
    ctx.opened(globex)

    expect(cache.of(acme)).not.toBe(cache.of(globex))
    expect(cache.current().id).toBe('globex')
  })

  it('refuses a Company that is not open rather than making one for it', () => {
    const ctx = createCompanyContext()
    const { cache, made } = counted(ctx)

    expect(() => cache.ofId('acme')).toThrow('not open')
    expect(() => cache.current()).toThrow('No Company is open')
    expect(made).toEqual([])
  })
})

describe('closing a Company', () => {
  /** The generalisation of #410: the cache does not have to be named anywhere to be emptied. */
  it('empties every cache keyed by it, including ones nothing else knows about', () => {
    const ctx = createCompanyContext()
    const caches = Array.from({ length: 12 }, () => counted(ctx))
    const acme = entry('acme')
    ctx.opened(acme)
    for (const { cache } of caches) cache.of(acme)

    ctx.close('acme')

    for (const { cache, disposed } of caches) {
      expect(cache.peek('acme')).toBeUndefined()
      expect(cache.made()).toEqual([])
      expect(disposed).toEqual(['acme'])
    }
  })

  it('leaves the Companies that are still open alone', () => {
    const ctx = createCompanyContext()
    const { cache, disposed } = counted(ctx)
    const acme = entry('acme')
    const globex = entry('globex')
    ctx.opened(acme)
    ctx.opened(globex)
    const kept = cache.of(globex)
    cache.of(acme)

    ctx.close('acme')

    expect(cache.peek('globex')).toBe(kept)
    expect(disposed).toEqual(['acme'])
  })

  it('makes a fresh value when the same Company is opened again, which is what a move is', () => {
    const ctx = createCompanyContext()
    const { cache, made } = counted(ctx)
    const before = entry('acme')
    ctx.opened(before)
    const first = cache.of(before)

    // Move…: the Company is closed, its folder moves, and it is opened again under the same id.
    ctx.close('acme')
    const after = entry('acme')
    ctx.opened(after)

    expect(cache.of(after)).not.toBe(first)
    expect(made).toEqual(['acme', 'acme'])
  })

  it('says whether it was the Company the boss was looking at, which is who has to be told', () => {
    const ctx = createCompanyContext()
    const acme = entry('acme')
    const globex = entry('globex')
    ctx.opened(acme)
    ctx.opened(globex)

    expect(ctx.close('acme')).toBe(false)
    expect(ctx.currentId()).toBe('globex')
    expect(ctx.close('globex')).toBe(true)
    expect(ctx.currentId()).toBe(null)
  })

  it('disposes nothing for a cache that was never asked about it', () => {
    const ctx = createCompanyContext()
    const { cache, disposed } = counted(ctx)
    ctx.opened(entry('acme'))

    ctx.close('acme')

    expect(disposed).toEqual([])
    expect(cache.made()).toEqual([])
  })
})

describe('quitting', () => {
  it('empties every cache for every Company and every listener set', () => {
    const ctx = createCompanyContext()
    const caches = Array.from({ length: 3 }, () => counted(ctx))
    const listeners = ctx.listeners()
    listeners.add(() => {})
    const acme = entry('acme')
    const globex = entry('globex')
    ctx.opened(acme)
    ctx.opened(globex)
    for (const { cache } of caches) {
      cache.of(acme)
      cache.of(globex)
    }

    ctx.clear()

    expect(ctx.open()).toEqual([])
    expect(ctx.currentId()).toBe(null)
    expect(listeners.size()).toBe(0)
    for (const { cache, disposed } of caches) {
      expect(cache.made()).toEqual([])
      expect(disposed.sort()).toEqual(['acme', 'globex'])
    }
  })
})

describe('the open Companies', () => {
  it('are read by id, by folder and as a list, and the current one is the last opened', () => {
    const ctx = createCompanyContext()
    const acme = entry('acme')
    ctx.opened(acme)
    ctx.opened(entry('globex'))

    expect(ctx.ids()).toEqual(['acme', 'globex'])
    expect(ctx.entryOf('acme')).toBe(acme)
    expect(ctx.entryOf('nobody')).toBe(null)
    expect(ctx.openedAt(onDisk('/work/acme'))).toBe(acme)
    expect(ctx.openedAt(onDisk('/work/nowhere'))).toBe(null)
    expect(ctx.currentEntry().company.id).toBe('globex')

    ctx.switchTo('acme')
    expect(ctx.currentEntry()).toBe(acme)
    expect(() => ctx.switchTo('nobody')).toThrow('not open')
  })

  it('carry the row the engine last read, so a rename is seen by everything holding the entry', () => {
    const ctx = createCompanyContext()
    const acme = entry('acme', 'Acme')
    ctx.opened(acme)

    ctx.reread('acme', { ...acme.company, name: 'Acme Corp' })

    expect(ctx.currentEntry().company.name).toBe('Acme Corp')
    expect(acme.company.name).toBe('Acme Corp')
  })
})

describe('a listener set', () => {
  it('calls in the order they were added, and takes one off again', () => {
    const ctx = createCompanyContext()
    const listeners = ctx.listeners<[string]>()
    const heard: string[] = []
    listeners.add((what) => heard.push(`first ${what}`))
    const off = listeners.add((what) => heard.push(`second ${what}`))

    listeners.notify('go')
    off()
    listeners.notify('again')

    expect(heard).toEqual(['first go', 'second go', 'first again'])
    expect(listeners.size()).toBe(1)
  })
})
