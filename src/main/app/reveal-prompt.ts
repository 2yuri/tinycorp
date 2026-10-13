import { dialog, systemPreferences } from 'electron'
import type { AskWhoIsThere } from '../../shared/environments'

/**
 * Asking who is there before a secret is shown or copied (T176, frame `aD50i`, d).
 *
 * On a Mac this is `promptTouchID`, which is the sensor or the watch. Where there is no sensor —
 * an older Mac, a Windows machine — there is a confirmation dialog instead, and the answer says
 * `confirmation` so the screen can say out loud that Reveal is not protected by anything more
 * there. That honesty is the point: a lock drawn over no lock is worse than no lock.
 */

export const askWhoIsThere: AskWhoIsThere = async (reason) => {
  if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
    try {
      await systemPreferences.promptTouchID(reason)
      return { ok: true, protection: 'touch-id' }
    } catch {
      // The sheet also offers the boss's password, so a rejection here is a refusal either way.
      return { ok: false, cancelled: true }
    }
  }
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Show it', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: reason,
    detail:
      'This machine has no Touch ID prompt for TinyCorp to use, so this is the only thing standing ' +
      'between the value and whoever is at this keyboard.',
  })
  return response === 0 ? { ok: true, protection: 'confirmation' } : { ok: false, cancelled: true }
}
