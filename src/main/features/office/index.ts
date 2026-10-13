/**
 * The office: rooms, desks, sprites and where everyone is.
 *
 * The feature's front door. The pixels themselves are drawn in the renderer from `src/shared/office`;
 * what is here is the facts they are drawn from, the room the Company works in, and its IPC module.
 */

export { registerOfficeIpc } from './ipc'
export { OFFICE_ROOM_MIGRATION } from './office-room'
export type { OfficeFacade } from './wire'
export { register as registerOffice } from './wire'
