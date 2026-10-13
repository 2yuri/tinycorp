/** Money, as the storefront writes it. Every amount is in minor units and never a float. */

export interface Money {
  /** Cents, pence, øre — whatever the currency's minor unit is. */
  amount: number
  currency: string
}

/** The symbol a currency is written with, or its code when we do not know one. */
export function symbolOf(currency: string): string {
  const known: Record<string, string> = { EUR: '€', GBP: '£', USD: '$' }
  return known[currency] ?? currency
}

/**
 * One amount, as a person reads it. The rounding is half-up on the minor unit, which is what the
 * invoices have always done and what the yearly plan's totals are checked against.
 */
export function format(money: Money): string {
  const whole = Math.trunc(money.amount / 100)
  const rest = Math.abs(money.amount % 100)
  return `${symbolOf(money.currency)}${whole}.${String(rest).padStart(2, '0')}`
}

/** The sum of a line of amounts. Mixed currencies are a bug, so this refuses them out loud. */
export function total(amounts: Money[]): Money {
  const first = amounts[0]
  if (!first) return { amount: 0, currency: 'EUR' }
  for (const one of amounts) {
    if (one.currency !== first.currency) throw new Error(`cannot add ${one.currency} to ${first.currency}`)
  }
  return { amount: amounts.reduce((sum, one) => sum + one.amount, 0), currency: first.currency }
}
