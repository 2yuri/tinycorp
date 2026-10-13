/**
 * The QA pass a ticket gets after review (T174), and the apps `Run it` starts in its worktree.
 *
 * The feature's front door. The two are one feature because they call each other: a ticket entering
 * Testing may start an app, and a ticket leaving it stops one.
 */

export type { AppRuns } from './app-runs'
export type { TestingFacade } from './facade'
export { registerTestingIpc } from './ipc'
export { type EmployeeTests, TEST_FLOW_MIGRATION } from './test-flow'
export { TESTING_SETTINGS_MIGRATION } from './test-settings'
export { registerTestTools } from './tools'
export { register as registerTesting, type TestingOptions } from './wire'
