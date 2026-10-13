import { format, type Money, total } from './currency'

/** One line of an invoice: what was used, how much of it, and what it cost. */
export interface Line {
  name: string
  quantity: number
  each: Money
}

/** An invoice as the customer receives it. */
export interface Invoice {
  number: string
  issuedAt: string
  lines: Line[]
}

/** What one line comes to. */
export function lineTotal(line: Line): Money {
  return { amount: line.each.amount * line.quantity, currency: line.each.currency }
}

/** What the whole invoice comes to, as a string the template prints. */
export function invoiceTotal(invoice: Invoice): string {
  return format(total(invoice.lines.map(lineTotal)))
}
