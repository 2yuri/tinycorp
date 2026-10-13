# Billing

How the storefront charges, in the order it happens.

## The cycle

1. Usage is counted as it happens, per account, in minor units.
2. On the first of the month the counts are frozen and an invoice is drawn from them.
3. The invoice is charged against the card on file, and the receipt is emailed.

A failed charge is retried three times over six days, and the account is not suspended before the
third failure. Nothing is ever charged twice: the invoice number is the idempotency key.

## Rounding

Every amount is in minor units, so there is nothing to round until the total is printed. The one
place rounding happens is `format`, in the currency module, half-up on the minor unit.

## What is not here

Tax. The rates are per country and per product and they change without notice, so they are read
from the tax service at the moment the invoice is drawn, never cached.
