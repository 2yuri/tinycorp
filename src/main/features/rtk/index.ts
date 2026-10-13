/**
 * RTK: compressing what an Employee reads before it reads it (T179).
 *
 * The feature's front door. TinyCorp never installs RTK and never hooks it globally — it is found
 * on `PATH` and hooked per Session, into the config each Provider's adapter already writes. What
 * RTK is, and the sentences the Tokens tab draws, are in `src/shared/rtk`.
 */

export { registerRtkIpc } from './ipc'
export { RTK_MIGRATION } from './rtk'
export type { RtkFacade } from './wire'
export { type RtkOptions, register as registerRtk } from './wire'
