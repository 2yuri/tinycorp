/**
 * The first launch on Windows, and the card in Your profile that changes what it asked (T249).
 *
 * The front door: what the other folders may name, and nothing else in here is theirs.
 */

import { publishIpcValue, resources, useIpcResource } from '../ipc'

export { OnThisPcCard } from './OnThisPcCard'
export { WindowsSetupStep } from './WindowsSetupStep'
export { windowsSetupTakesTheWindow } from './windows-setup-model'

/**
 * What this machine is, and how to ask it again.
 *
 * `Check again` walks the `PATH` afresh in the main process and hands the answer straight back
 * into the store, so the boss who has just installed Git for Windows in the other window sees the
 * notice go without anything else being asked of the machine.
 */
export function useWindowsMachine() {
  const machine = useIpcResource(resources.windowsMachine)
  return {
    machine,
    async recheck() {
      publishIpcValue(resources.windowsMachine, await window.tinyCorp.windows.recheck())
    },
  }
}
