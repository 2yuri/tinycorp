/**
 * The name every call between the two processes travels under.
 *
 * One file, importing nothing: an IPC module registers `chatChannels.post`, the preload script
 * forwards it and the renderer calls it, and none of the three has to load the type of every
 * screen in the app to learn the string. The shapes those calls carry live beside their `*Api`
 * interface in `src/shared/ipc.ts`; the strings live here, in the same order (T184).
 *
 * A channel id is written once and never spelled by hand anywhere else — a typo is a call that
 * silently never arrives.
 */

export const voiceChannels = {
  colleague: 'voice:colleague',
  setColleague: 'voice:set-colleague',
  changed: 'voice:changed',
} as const

/** The settings a Session bakes in at spawn, and the `Apply now` beside them (T237). */
export const spawnSettingsChannels = {
  stale: 'spawn-settings:stale',
  applyNow: 'spawn-settings:apply-now',
  changed: 'spawn-settings:changed',
} as const

/** Lean builder, the Company's one build add-on (T194). */
export const buildStyleChannels = {
  get: 'build-style:get',
  set: 'build-style:set',
} as const

/** Caveman, the Company's one answering add-on (T261). */
export const cavemanChannels = {
  get: 'caveman:get',
  set: 'caveman:set',
} as const

export const profileChannels = {
  get: 'profile:get',
  update: 'profile:update',
  changed: 'profile:changed',
} as const

/** What this Windows is: its distros and its Git Bash (T249). Answered `windows: false` elsewhere. */
export const windowsChannels = {
  machine: 'windows:machine',
  recheck: 'windows:recheck',
} as const

export const activityChannels = {
  list: 'activity:list',
  actors: 'activity:actors',
  changed: 'activity:changed',
} as const

export const companyChannels = {
  current: 'company:current',
  list: 'company:list',
  create: 'company:create',
  open: 'company:open',
  switchTo: 'company:switch',
  update: 'company:update',
  forget: 'company:forget',
  delete: 'company:delete',
  pickFolder: 'company:pick-folder',
  folderHints: 'company:folder-hints',
  move: 'company:move',
  temporaryRoots: 'company:temporary-roots',
  changed: 'company:changed',
  attention: 'company:attention',
  attentionChanged: 'company:attention-changed',
  chooseLogo: 'company:choose-logo',
  removeLogo: 'company:remove-logo',
} as const

export const staffChannels = {
  roles: 'staff:roles',
  createRole: 'staff:create-role',
  updateRole: 'staff:update-role',
  deleteRole: 'staff:delete-role',
  removeUnusedRoles: 'staff:remove-unused-roles',
  employees: 'staff:employees',
  hire: 'staff:hire',
  updateEmployee: 'staff:update-employee',
  permissionDefault: 'staff:permission-default',
  setPermissionDefault: 'staff:set-permission-default',
  changed: 'staff:changed',
} as const

export const repoChannels = {
  list: 'repos:list',
  add: 'repos:add',
  update: 'repos:update',
  remove: 'repos:remove',
  pickFolder: 'repos:pick-folder',
  inspect: 'repos:inspect',
  initialise: 'repos:initialise',
  planStart: 'repos:plan-start',
  remoteOffers: 'repos:remote-offers',
  createRemote: 'repos:create-remote',
  worktreeRoots: 'repos:worktree-roots',
  pickScanFolder: 'repos:pick-scan-folder',
  scan: 'repos:scan',
  findRepos: 'repos:find',
  stopFinding: 'repos:stop-finding',
  found: 'repos:found',
  inspectMany: 'repos:inspect-many',
  attachScanned: 'repos:attach-scanned',
  nearby: 'repos:nearby',
  changed: 'repos:changed',
} as const

export const boardChannels = {
  snapshot: 'board:snapshot',
  apply: 'board:apply',
  ticketRemoval: 'board:ticket-removal',
  deleteTicket: 'board:delete-ticket',
  changed: 'board:changed',
} as const

export const sessionChannels = {
  list: 'sessions:list',
  start: 'sessions:start',
  stop: 'sessions:stop',
  paused: 'sessions:paused',
  pauseAll: 'sessions:pause-all',
  resumeAll: 'sessions:resume-all',
  handoffCommand: 'sessions:handoff-command',
  changed: 'sessions:changed',
} as const

export const terminalChannels = {
  attach: 'terminals:attach',
  detach: 'terminals:detach',
  write: 'terminals:write',
  resize: 'terminals:resize',
  clipboard: 'terminals:clipboard',
  data: 'terminals:data',
} as const

export const chatChannels = {
  channels: 'chat:channels',
  read: 'chat:read',
  post: 'chat:post',
  reply: 'chat:reply',
  attachment: 'chat:attachment',
  attachmentLimits: 'chat:attachment-limits',
  unread: 'chat:unread',
  markRead: 'chat:mark-read',
  bossInbox: 'chat:boss-inbox',
  conversations: 'chat:conversations',
  agentPairs: 'chat:agent-pairs',
  markAllRead: 'chat:mark-all-read',
  channelRemoval: 'chat:channel-removal',
  deleteChannel: 'chat:delete-channel',
  setTopic: 'chat:set-topic',
  setMembers: 'chat:set-members',
  pin: 'chat:pin',
  pins: 'chat:pins',
  search: 'chat:search',
  draft: 'chat:draft',
  saveDraft: 'chat:save-draft',
  clearDraft: 'chat:clear-draft',
  draftedChannels: 'chat:drafted-channels',
  draftFile: 'chat:draft-file',
  changed: 'chat:changed',
} as const

export const inboxChannels = {
  list: 'inbox:list',
  changed: 'inbox:changed',
} as const

export const companyMemoryChannels = {
  folder: 'company-memory:folder',
  list: 'company-memory:list',
  counts: 'company-memory:counts',
  get: 'company-memory:get',
  write: 'company-memory:write',
  pin: 'company-memory:pin',
  archive: 'company-memory:archive',
  link: 'company-memory:link',
  history: 'company-memory:history',
  restore: 'company-memory:restore',
  fromTicket: 'company-memory:from-ticket',
  filePath: 'company-memory:file-path',
  rebuild: 'company-memory:rebuild',
  coldDays: 'company-memory:cold-days',
  setColdDays: 'company-memory:set-cold-days',
  changed: 'company-memory:changed',
} as const

export const notesChannels = {
  view: 'notes:view',
  addNote: 'notes:add-note',
  zoom: 'notes:zoom',
  search: 'notes:search',
  raw: 'notes:raw',
  budget: 'notes:budget',
  setBudget: 'notes:set-budget',
} as const

export const answererChannels = {
  get: 'answerer:get',
  set: 'answerer:set',
  changed: 'answerer:changed',
} as const

export const capacityChannels = {
  get: 'capacity:get',
  usage: 'capacity:usage',
  setConcurrencyCap: 'capacity:set-concurrency-cap',
  changed: 'capacity:changed',
} as const

export const usageChannels = {
  read: 'usage:read',
  refresh: 'usage:refresh',
  changed: 'usage:changed',
} as const

export const routingChannels = {
  get: 'routing:get',
  setRule: 'routing:set-rule',
  setMoveBack: 'routing:set-move-back',
  setResumeAtReset: 'routing:set-resume-at-reset',
  setRotateAccounts: 'routing:set-rotate-accounts',
  setPinnedAccount: 'routing:set-pinned-account',
  setEmployeeRule: 'routing:set-employee-rule',
  setEmployeePin: 'routing:set-employee-pin',
  addAccount: 'routing:add-account',
  renameAccount: 'routing:rename-account',
  setDefaultAccount: 'routing:set-default-account',
  removeAccount: 'routing:remove-account',
  continueNow: 'routing:continue-now',
  moveBackNow: 'routing:move-back-now',
  changed: 'routing:changed',
} as const

/** The sign-in modal's terminal (T263). */
export const signInChannels = {
  start: 'sign-in:start',
  write: 'sign-in:write',
  resize: 'sign-in:resize',
  cancel: 'sign-in:cancel',
  data: 'sign-in:data',
  state: 'sign-in:state',
} as const

export const environmentChannels = {
  get: 'environments:get',
  setAskEveryUse: 'environments:set-ask-every-use',
  setAvailableToChecks: 'environments:set-available-to-checks',
  add: 'environments:add',
  update: 'environments:update',
  remove: 'environments:remove',
  setRepoDefault: 'environments:set-repo-default',
  reveal: 'environments:reveal',
  copy: 'environments:copy',
  pickEnvFile: 'environments:pick-env-file',
  importKeys: 'environments:import-keys',
  changed: 'environments:changed',
} as const

export const approvalChannels = {
  level: 'approvals:level',
  setLevel: 'approvals:set-level',
  list: 'approvals:list',
  decide: 'approvals:decide',
  changed: 'approvals:changed',
} as const

export const onboardingChannels = {
  progress: 'onboarding:progress',
  save: 'onboarding:save',
  finish: 'onboarding:finish',
} as const

export const officeChannels = {
  facts: 'office:facts',
  room: 'office:room',
  setRoom: 'office:set-room',
  changed: 'office:changed',
} as const

/** The Sandbox add-on, which runs every Employee's Session inside ai-jail (T260). */
export const sandboxChannels = {
  read: 'sandbox:read',
  recheck: 'sandbox:recheck',
  setEnabled: 'sandbox:set-enabled',
  changed: 'sandbox:changed',
} as const

export const rtkChannels = {
  read: 'rtk:read',
  recheck: 'rtk:recheck',
  setEnabled: 'rtk:set-enabled',
  setPing: 'rtk:set-ping',
  savings: 'rtk:savings',
  changed: 'rtk:changed',
} as const

export const skillChannels = {
  list: 'skills:list',
  add: 'skills:add',
  update: 'skills:update',
  impact: 'skills:impact',
  remove: 'skills:remove',
  pickFolder: 'skills:pick-folder',
  found: 'skills:found',
  addFound: 'skills:add-found',
  described: 'skills:described',
  changed: 'skills:changed',
} as const

export const mcpChannels = {
  list: 'mcp:list',
  importScan: 'mcp:import-scan',
  importServers: 'mcp:import-servers',
  found: 'mcp:found',
  addFound: 'mcp:add-found',
  addPreset: 'mcp:add-preset',
  add: 'mcp:add',
  update: 'mcp:update',
  impact: 'mcp:impact',
  remove: 'mcp:remove',
  changed: 'mcp:changed',
} as const

export const hiringChannels = {
  teamLoad: 'hiring:team-load',
  former: 'hiring:former',
  fire: 'hiring:fire',
  rehire: 'hiring:rehire',
  requests: 'hiring:requests',
  updateProposal: 'hiring:update-proposal',
  suggestName: 'hiring:suggest-name',
  headcount: 'hiring:headcount',
  setMaxHeadcount: 'hiring:set-max-headcount',
  setRequestModel: 'hiring:set-request-model',
} as const

export const codeChannels = {
  list: 'code:list',
  details: 'code:details',
  changed: 'code:changed',
} as const

export const restorePointChannels = {
  of: 'restore-points:of',
  losses: 'restore-points:losses',
  goBack: 'restore-points:go-back',
  changed: 'restore-points:changed',
} as const

export const digestChannels = {
  schedule: 'digest:schedule',
  setSchedule: 'digest:set-schedule',
  changed: 'digest:changed',
} as const

export const notificationChannels = {
  enabled: 'notifications:enabled',
  setEnabled: 'notifications:set-enabled',
  test: 'notifications:test',
  delivery: 'notifications:delivery',
  openSystemSettings: 'notifications:open-system-settings',
  changed: 'notifications:changed',
  focus: 'notifications:focus',
} as const

export const testChannels = {
  of: 'tests:of',
  list: 'tests:list',
  addStep: 'tests:add-step',
  setStep: 'tests:set-step',
  attach: 'tests:attach',
  capture: 'tests:capture',
  openAttachment: 'tests:open-attachment',
  pass: 'tests:pass',
  reportBug: 'tests:report-bug',
  runnable: 'tests:runnable',
  startApp: 'tests:start-app',
  stopApp: 'tests:stop-app',
  appLog: 'tests:app-log',
  settings: 'tests:settings',
  setMode: 'tests:set-mode',
  setRepo: 'tests:set-repo',
  changed: 'tests:changed',
} as const

export const planningChannels = {
  list: 'planning:list',
  versions: 'planning:versions',
  answer: 'planning:answer',
  delegate: 'planning:delegate',
  approve: 'planning:approve',
  requestChanges: 'planning:request-changes',
  keep: 'planning:keep',
  replan: 'planning:replan',
  changed: 'planning:changed',
} as const

export const reviewChannels = {
  list: 'reviews:list',
  threads: 'reviews:threads',
  openThread: 'reviews:open-thread',
  replyInThread: 'reviews:reply-in-thread',
  setThreadState: 'reviews:set-thread-state',
  threadsOnForge: 'reviews:threads-on-forge',
  roundLimit: 'reviews:round-limit',
  setRoundLimit: 'reviews:set-round-limit',
  approve: 'reviews:approve',
  requestChanges: 'reviews:request-changes',
  diff: 'reviews:diff',
  fileSides: 'reviews:file-sides',
  comments: 'reviews:comments',
  comment: 'reviews:comment',
  securityPasses: 'reviews:security-passes',
  securityOverride: 'reviews:security-override',
  securityScope: 'reviews:security-scope',
  setSecurityScope: 'reviews:set-security-scope',
  changed: 'reviews:changed',
} as const

export const pathsChannels = {
  links: 'paths:links',
  open: 'paths:open',
  reveal: 'paths:reveal',
  openInEditor: 'paths:open-in-editor',
} as const

export const editorsChannels = {
  get: 'editors:get',
  choose: 'editors:choose',
  changed: 'editors:changed',
} as const

export const languageChannels = {
  read: 'language:read',
  hover: 'language:hover',
  definition: 'language:definition',
} as const

export const filesChannels = {
  places: 'files:places',
  tree: 'files:tree',
  open: 'files:open',
  save: 'files:save',
  create: 'files:create',
  openInEditor: 'files:open-in-editor',
  reveal: 'files:reveal',
  changes: 'files:changes',
  changeDiff: 'files:change-diff',
  stage: 'files:stage',
  unstage: 'files:unstage',
  discard: 'files:discard',
  commit: 'files:commit',
  push: 'files:push',
  changed: 'files:changed',
} as const

export const shellChannels = {
  toggleMaximize: 'shell:toggle-maximize',
  closeRequest: 'shell:close-company',
  menuCommand: 'shell:menu-command',
} as const

export const keepAwakeChannels = {
  get: 'keep-awake:get',
  setMode: 'keep-awake:set-mode',
  changed: 'keep-awake:changed',
} as const

export const launcherChannels = {
  summaries: 'launcher:summaries',
  detectRepo: 'launcher:detect-repo',
  setWindowLayout: 'launcher:set-window-layout',
} as const

export const preflightChannels = {
  status: 'preflight:status',
  all: 'preflight:all',
  recheck: 'preflight:recheck',
  changed: 'preflight:changed',
} as const

export const crashChannels = {
  record: 'crash:record',
} as const

export const updateChannels = {
  get: 'updates:get',
  checkNow: 'updates:check-now',
  openDownloadPage: 'updates:open-download-page',
  changed: 'updates:changed',
} as const
