/**
 * The check that a Provider is installed and logged in, before anything is asked of it.
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

export { PreflightScreen, preflightTakesTheWindow, useDismissOnEscape } from './PreflightScreen'
export { useDefaultProvider, useEveryProvider, usePreflight } from './use-preflight'
