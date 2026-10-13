import { describe, expect, it } from 'vitest'
import designTokens from './design-tokens.json'
import tokensCss from './tokens.css?raw'

type Mode = 'Light' | 'Dark'
type TokenValue = string | number | Array<{ value: string; theme?: { Mode: Mode } }>

/** Custom properties declared in the first rule whose selector list contains `selector`. */
function declarations(selector: string): Map<string, string> {
  const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, selectors]) =>
    selectors!.split(',').some((s) => s.trim() === selector),
  )
  if (!rule) throw new Error(`no rule for ${selector}`)
  const map = new Map<string, string>()
  for (const [, name, value] of rule[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(name!, value!.trim())
  return map
}

function expected(value: TokenValue, mode: Mode): string {
  if (!Array.isArray(value)) return String(value)
  // A value without a theme is the document default, which is the Light mode.
  const themed = value.find((v) => v.theme?.Mode === mode) ?? value.find((v) => !v.theme)
  return themed!.value
}

const cssName = (name: string) => (name.startsWith('--') ? name : `--${name}`)
const dark = declarations(':root')
const light = declarations("[data-theme='light']")
const tokens = Object.entries(designTokens as Record<string, { type: string; value: TokenValue }>)

describe('design tokens', () => {
  it('declares every Pen variable on :root with its Dark value (Dark is the default)', () => {
    for (const [name, token] of tokens) {
      const actual = dark.get(cssName(name))
      expect(actual, name).toBeDefined()
      if (token.type === 'color') expect(actual!.toLowerCase(), name).toBe(expected(token.value, 'Dark').toLowerCase())
      if (token.type === 'number') expect(actual, name).toBe(`${token.value}px`)
      if (token.type === 'string') expect(actual, name).toContain(`${token.value}`)
    }
  })

  it('switches every themed colour to its Light value under data-theme="light"', () => {
    for (const [name, token] of tokens) {
      if (token.type !== 'color') continue
      const value = light.get(cssName(name)) ?? dark.get(cssName(name))
      expect(value?.toLowerCase(), name).toBe(expected(token.value, 'Light').toLowerCase())
    }
  })

  it('lets any subtree opt back into Dark with data-theme="dark"', () => {
    expect(declarations("[data-theme='dark']")).toEqual(dark)
  })
})
