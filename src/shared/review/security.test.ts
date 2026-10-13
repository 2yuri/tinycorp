import { describe, expect, it } from 'vitest'
import {
  blockingFindings,
  holdsTheMerge,
  riskClassesOf,
  securityChip,
  securityReason,
  securityRefusal,
} from './security'

const finding = (id: number, severity: 'high' | 'medium' | 'low', resolved: boolean) => ({
  id,
  passId: 1,
  severity,
  title: `finding ${id}`,
  fix: 'do the other thing',
  threadId: id,
  where: `src/main/app/ipc.ts:${id}`,
  resolved,
  createdAt: '2026-09-25T00:00:00.000Z',
})

describe('Which changes are risky', () => {
  it('names the class a path falls into, and says nothing about an ordinary one', () => {
    expect(riskClassesOf({ paths: ['src/main/features/auth/login.ts'] })).toEqual(['auth'])
    expect(riskClassesOf({ paths: ['src/preload/index.ts', 'pnpm-lock.yaml'] })).toEqual(['ipc', 'deps'])
    expect(riskClassesOf({ paths: ['src/main/platform/safe-storage-secrets.ts'] })).toEqual(['secrets', 'platform'])
    expect(riskClassesOf({ paths: ['src/format/currency.ts', 'README.md'] })).toEqual([])
  })

  it('reads a Windows path the same as a POSIX one', () => {
    expect(riskClassesOf({ paths: ['src\\main\\app\\Window-Policy.ts'] })).toEqual(['ipc'])
  })

  it('takes a ticket label as a class of its own', () => {
    expect(riskClassesOf({ paths: ['docs/readme.md'], labels: ['Deps'] })).toEqual(['deps'])
    // A label is matched whole: `dependency-injection` is not `deps`.
    expect(riskClassesOf({ paths: ['docs/readme.md'], labels: ['dependency-injection'] })).toEqual([])
  })
})

describe('Whether a change gets a pass', () => {
  it('asks on a risky path under the default scope, and not on an ordinary one', () => {
    expect(securityReason({ scope: 'risky', paths: ['src/main/app/window-policy.ts'] })).toEqual({
      kind: 'risky',
      classes: ['ipc'],
    })
    expect(securityReason({ scope: 'risky', paths: ['src/format/currency.ts'] })).toBeNull()
  })

  it('asks on every PR under `every`, and never under `off`', () => {
    expect(securityReason({ scope: 'every', paths: ['src/format/currency.ts'] })).toEqual({
      kind: 'every',
      classes: [],
    })
    expect(securityReason({ scope: 'off', paths: ['src/main/app/window-policy.ts'] })).toBeNull()
  })

  it('asks when the ticket is labelled for it, whatever the change touches', () => {
    expect(securityReason({ scope: 'risky', paths: ['docs/readme.md'], labels: ['security'] })).toEqual({
      kind: 'label',
      classes: [],
    })
  })
})

describe('What a pass does to the merge', () => {
  it('holds it while the pass is being read, and while a high finding is open', () => {
    expect(holdsTheMerge({ state: 'pending', findings: [] })).toBe(true)
    expect(holdsTheMerge({ state: 'findings', findings: [finding(1, 'high', false)] })).toBe(true)
    expect(holdsTheMerge({ state: 'findings', findings: [finding(1, 'high', true)] })).toBe(false)
    expect(holdsTheMerge({ state: 'findings', findings: [finding(1, 'medium', false)] })).toBe(false)
    expect(holdsTheMerge({ state: 'clear', findings: [] })).toBe(false)
  })

  it('lets an overridden pass through however much is open', () => {
    const overridden = { state: 'overridden' as const, findings: [finding(1, 'high', false)] }
    expect(blockingFindings(overridden)).toHaveLength(1)
    expect(holdsTheMerge(overridden)).toBe(false)
    expect(securityRefusal(overridden, 'AC-4')).toBeNull()
  })

  it('says which findings are in the way, with where each one is', () => {
    const refusal = securityRefusal({ state: 'findings', findings: [finding(7, 'high', false)] }, 'AC-4')
    expect(refusal).toContain('AC-4')
    expect(refusal).toContain('src/main/app/ipc.ts:7')
    expect(refusal).toMatch(/override/i)
  })
})

describe('The badge a card carries', () => {
  it('says who is reading, what is open, and when it is clear', () => {
    expect(securityChip({ state: 'pending', findings: [] }, 'Vega')).toEqual({
      tone: 'reading',
      text: 'Security: Vega reading',
    })
    expect(securityChip({ state: 'findings', findings: [finding(1, 'high', false)] }, 'Vega')).toEqual({
      tone: 'blocked',
      text: 'Security: 1 high open',
    })
    expect(securityChip({ state: 'findings', findings: [finding(1, 'medium', false)] }, 'Vega')).toEqual({
      tone: 'findings',
      text: 'Security: 1 medium',
    })
    expect(securityChip({ state: 'clear', findings: [] }, 'Vega')).toEqual({ tone: 'clear', text: 'Security clear' })
    expect(securityChip({ state: 'overridden', findings: [] }, 'Vega')).toEqual({
      tone: 'overridden',
      text: 'Security overridden',
    })
  })
})
