import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { KeepAwakeState } from '../shared/app/keep-awake'
import type { MenuCommand } from '../shared/app/menu'
import type { UpdateState } from '../shared/app/updates'
import type { Company } from '../shared/company'
import type { BoardSnapshot } from '../shared/domain/board'
import {
  activityChannels,
  answererChannels,
  approvalChannels,
  boardChannels,
  buildStyleChannels,
  capacityChannels,
  cavemanChannels,
  chatChannels,
  codeChannels,
  companyChannels,
  companyMemoryChannels,
  crashChannels,
  digestChannels,
  editorsChannels,
  environmentChannels,
  filesChannels,
  hiringChannels,
  inboxChannels,
  keepAwakeChannels,
  languageChannels,
  launcherChannels,
  mcpChannels,
  notesChannels,
  notificationChannels,
  officeChannels,
  onboardingChannels,
  pathsChannels,
  planningChannels,
  preflightChannels,
  profileChannels,
  repoChannels,
  restorePointChannels,
  reviewChannels,
  routingChannels,
  rtkChannels,
  sandboxChannels,
  sessionChannels,
  shellChannels,
  signInChannels,
  skillChannels,
  spawnSettingsChannels,
  staffChannels,
  terminalChannels,
  testChannels,
  updateChannels,
  usageChannels,
  voiceChannels,
  windowsChannels,
} from '../shared/domain/channels'
import type { EditorsState } from '../shared/files/editors'
import type { NotificationFocusRequest, TinyCorpApi } from '../shared/ipc'
import type { ProviderPreflight } from '../shared/providers/preflight'
import type { FoundReposEvent } from '../shared/repos/found-repos'
import type { SignInState } from '../shared/usage/sign-in'

const api: TinyCorpApi = {
  launcher: {
    summaries: () => ipcRenderer.invoke(launcherChannels.summaries),
    detectRepo: (path) => ipcRenderer.invoke(launcherChannels.detectRepo, path),
    setWindowLayout: (layout) => ipcRenderer.invoke(launcherChannels.setWindowLayout, layout),
  },
  company: {
    current: () => ipcRenderer.invoke(companyChannels.current),
    list: () => ipcRenderer.invoke(companyChannels.list),
    create: (input) => ipcRenderer.invoke(companyChannels.create, input),
    open: (folder) => ipcRenderer.invoke(companyChannels.open, folder),
    switchTo: (id) => ipcRenderer.invoke(companyChannels.switchTo, id),
    update: (update) => ipcRenderer.invoke(companyChannels.update, update),
    forget: (id) => ipcRenderer.invoke(companyChannels.forget, id),
    delete: (id) => ipcRenderer.invoke(companyChannels.delete, id),
    pickFolder: () => ipcRenderer.invoke(companyChannels.pickFolder),
    chooseLogo: () => ipcRenderer.invoke(companyChannels.chooseLogo),
    removeLogo: () => ipcRenderer.invoke(companyChannels.removeLogo),
    folderHints: () => ipcRenderer.invoke(companyChannels.folderHints),
    move: (id) => ipcRenderer.invoke(companyChannels.move, id),
    temporaryRoots: () => ipcRenderer.invoke(companyChannels.temporaryRoots),
    onChanged(listener) {
      const handler = (_event: unknown, company: Company | null) => listener(company)
      ipcRenderer.on(companyChannels.changed, handler)
      return () => ipcRenderer.off(companyChannels.changed, handler)
    },
    attention: () => ipcRenderer.invoke(companyChannels.attention),
    onAttentionChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(companyChannels.attentionChanged, handler)
      return () => ipcRenderer.off(companyChannels.attentionChanged, handler)
    },
  },
  staff: {
    roles: () => ipcRenderer.invoke(staffChannels.roles),
    createRole: (input) => ipcRenderer.invoke(staffChannels.createRole, input),
    updateRole: (id, patch) => ipcRenderer.invoke(staffChannels.updateRole, id, patch),
    deleteRole: (id, options) => ipcRenderer.invoke(staffChannels.deleteRole, id, options),
    removeUnusedRoles: () => ipcRenderer.invoke(staffChannels.removeUnusedRoles),
    employees: () => ipcRenderer.invoke(staffChannels.employees),
    hire: (input) => ipcRenderer.invoke(staffChannels.hire, input),
    updateEmployee: (id, patch) => ipcRenderer.invoke(staffChannels.updateEmployee, id, patch),
    permissionDefault: () => ipcRenderer.invoke(staffChannels.permissionDefault),
    setPermissionDefault: (mode) => ipcRenderer.invoke(staffChannels.setPermissionDefault, mode),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(staffChannels.changed, handler)
      return () => ipcRenderer.off(staffChannels.changed, handler)
    },
  },
  repos: {
    list: () => ipcRenderer.invoke(repoChannels.list),
    add: (input) => ipcRenderer.invoke(repoChannels.add, input),
    update: (id, changes) => ipcRenderer.invoke(repoChannels.update, id, changes),
    remove: (id) => ipcRenderer.invoke(repoChannels.remove, id),
    pickFolder: () => ipcRenderer.invoke(repoChannels.pickFolder),
    inspect: (path) => ipcRenderer.invoke(repoChannels.inspect, path),
    initialise: (path) => ipcRenderer.invoke(repoChannels.initialise, path),
    planStart: (path) => ipcRenderer.invoke(repoChannels.planStart, path),
    remoteOffers: () => ipcRenderer.invoke(repoChannels.remoteOffers),
    createRemote: (path, remote) => ipcRenderer.invoke(repoChannels.createRemote, path, remote),
    worktreeRoots: () => ipcRenderer.invoke(repoChannels.worktreeRoots),
    pickScanFolder: () => ipcRenderer.invoke(repoChannels.pickScanFolder),
    scan: (folder) => ipcRenderer.invoke(repoChannels.scan, folder),
    findRepos: (folder, scan) => ipcRenderer.invoke(repoChannels.findRepos, folder, scan),
    stopFinding: (scan) => ipcRenderer.invoke(repoChannels.stopFinding, scan),
    onFound(listener) {
      const handler = (_event: unknown, found: FoundReposEvent) => listener(found)
      ipcRenderer.on(repoChannels.found, handler)
      return () => ipcRenderer.off(repoChannels.found, handler)
    },
    inspectMany: (paths) => ipcRenderer.invoke(repoChannels.inspectMany, paths),
    attachScanned: (paths, briefs) => ipcRenderer.invoke(repoChannels.attachScanned, paths, briefs),
    nearby: () => ipcRenderer.invoke(repoChannels.nearby),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(repoChannels.changed, handler)
      return () => ipcRenderer.off(repoChannels.changed, handler)
    },
  },
  board: {
    snapshot: () => ipcRenderer.invoke(boardChannels.snapshot),
    apply: (command) => ipcRenderer.invoke(boardChannels.apply, command),
    ticketRemoval: (ticketId) => ipcRenderer.invoke(boardChannels.ticketRemoval, ticketId),
    deleteTicket: (ticketId) => ipcRenderer.invoke(boardChannels.deleteTicket, ticketId),
    onChanged(listener) {
      const handler = (_event: unknown, board: BoardSnapshot | null) => listener(board)
      ipcRenderer.on(boardChannels.changed, handler)
      return () => ipcRenderer.off(boardChannels.changed, handler)
    },
  },
  sessions: {
    list: () => ipcRenderer.invoke(sessionChannels.list),
    start: (employeeId) => ipcRenderer.invoke(sessionChannels.start, employeeId),
    stop: (employeeId) => ipcRenderer.invoke(sessionChannels.stop, employeeId),
    paused: () => ipcRenderer.invoke(sessionChannels.paused),
    pauseAll: () => ipcRenderer.invoke(sessionChannels.pauseAll),
    resumeAll: () => ipcRenderer.invoke(sessionChannels.resumeAll),
    handoffCommand: (employeeId) => ipcRenderer.invoke(sessionChannels.handoffCommand, employeeId),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(sessionChannels.changed, handler)
      return () => ipcRenderer.off(sessionChannels.changed, handler)
    },
  },
  terminals: {
    attach: (employeeId) => ipcRenderer.invoke(terminalChannels.attach, employeeId),
    detach: (employeeId) => ipcRenderer.invoke(terminalChannels.detach, employeeId),
    write: (employeeId, data) => ipcRenderer.invoke(terminalChannels.write, employeeId, data),
    resize: (employeeId, cols, rows) => ipcRenderer.invoke(terminalChannels.resize, employeeId, cols, rows),
    clipboard: () => ipcRenderer.invoke(terminalChannels.clipboard),
    onData(listener) {
      const handler = (_event: unknown, employeeId: string, data: string) => listener(employeeId, data)
      ipcRenderer.on(terminalChannels.data, handler)
      return () => ipcRenderer.off(terminalChannels.data, handler)
    },
  },
  chat: {
    channels: () => ipcRenderer.invoke(chatChannels.channels),
    read: (query) => ipcRenderer.invoke(chatChannels.read, query),
    post: (channelId, text, attachments) => ipcRenderer.invoke(chatChannels.post, channelId, text, attachments),
    reply: (messageId, text, attachments) => ipcRenderer.invoke(chatChannels.reply, messageId, text, attachments),
    attachment: (id) => ipcRenderer.invoke(chatChannels.attachment, id),
    attachmentLimits: () => ipcRenderer.invoke(chatChannels.attachmentLimits),
    unread: () => ipcRenderer.invoke(chatChannels.unread),
    markRead: (channelId) => ipcRenderer.invoke(chatChannels.markRead, channelId),
    bossInbox: () => ipcRenderer.invoke(chatChannels.bossInbox),
    conversations: (employeeId) => ipcRenderer.invoke(chatChannels.conversations, employeeId),
    agentPairs: () => ipcRenderer.invoke(chatChannels.agentPairs),
    markAllRead: () => ipcRenderer.invoke(chatChannels.markAllRead),
    channelRemoval: (channelId) => ipcRenderer.invoke(chatChannels.channelRemoval, channelId),
    deleteChannel: (channelId) => ipcRenderer.invoke(chatChannels.deleteChannel, channelId),
    setTopic: (channelId, topic) => ipcRenderer.invoke(chatChannels.setTopic, channelId, topic),
    setMembers: (channelId, memberIds) => ipcRenderer.invoke(chatChannels.setMembers, channelId, memberIds),
    pin: (messageId, pinned) => ipcRenderer.invoke(chatChannels.pin, messageId, pinned),
    pins: (channelId) => ipcRenderer.invoke(chatChannels.pins, channelId),
    search: (query) => ipcRenderer.invoke(chatChannels.search, query),
    draft: (key) => ipcRenderer.invoke(chatChannels.draft, key),
    saveDraft: (key, draft) => ipcRenderer.invoke(chatChannels.saveDraft, key, draft),
    clearDraft: (key) => ipcRenderer.invoke(chatChannels.clearDraft, key),
    draftedChannels: () => ipcRenderer.invoke(chatChannels.draftedChannels),
    draftFile: (key, path) => ipcRenderer.invoke(chatChannels.draftFile, key, path),
    pathOf: (file) => webUtils.getPathForFile(file),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(chatChannels.changed, handler)
      return () => ipcRenderer.off(chatChannels.changed, handler)
    },
  },
  inbox: {
    list: (employeeId) => ipcRenderer.invoke(inboxChannels.list, employeeId),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(inboxChannels.changed, handler)
      return () => ipcRenderer.off(inboxChannels.changed, handler)
    },
  },
  notes: {
    view: (employeeId) => ipcRenderer.invoke(notesChannels.view, employeeId),
    addNote: (employeeId, text) => ipcRenderer.invoke(notesChannels.addNote, employeeId, text),
    zoom: (employeeId, range) => ipcRenderer.invoke(notesChannels.zoom, employeeId, range),
    search: (employeeId, query) => ipcRenderer.invoke(notesChannels.search, employeeId, query),
    raw: (employeeId) => ipcRenderer.invoke(notesChannels.raw, employeeId),
    budget: () => ipcRenderer.invoke(notesChannels.budget),
    setBudget: (tokens) => ipcRenderer.invoke(notesChannels.setBudget, tokens),
  },
  companyMemory: {
    folder: () => ipcRenderer.invoke(companyMemoryChannels.folder),
    list: (query) => ipcRenderer.invoke(companyMemoryChannels.list, query),
    counts: () => ipcRenderer.invoke(companyMemoryChannels.counts),
    get: (slug) => ipcRenderer.invoke(companyMemoryChannels.get, slug),
    write: (input) => ipcRenderer.invoke(companyMemoryChannels.write, input),
    pin: (slug, pinned) => ipcRenderer.invoke(companyMemoryChannels.pin, slug, pinned),
    archive: (slug) => ipcRenderer.invoke(companyMemoryChannels.archive, slug),
    link: (a, b) => ipcRenderer.invoke(companyMemoryChannels.link, a, b),
    history: (slug) => ipcRenderer.invoke(companyMemoryChannels.history, slug),
    restore: (slug, commit) => ipcRenderer.invoke(companyMemoryChannels.restore, slug, commit),
    fromTicket: (ticket) => ipcRenderer.invoke(companyMemoryChannels.fromTicket, ticket),
    filePath: (slug) => ipcRenderer.invoke(companyMemoryChannels.filePath, slug),
    rebuild: () => ipcRenderer.invoke(companyMemoryChannels.rebuild),
    coldDays: () => ipcRenderer.invoke(companyMemoryChannels.coldDays),
    setColdDays: (days) => ipcRenderer.invoke(companyMemoryChannels.setColdDays, days),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(companyMemoryChannels.changed, handler)
      return () => ipcRenderer.off(companyMemoryChannels.changed, handler)
    },
  },
  capacity: {
    get: () => ipcRenderer.invoke(capacityChannels.get),
    usage: () => ipcRenderer.invoke(capacityChannels.usage),
    setConcurrencyCap: (cap) => ipcRenderer.invoke(capacityChannels.setConcurrencyCap, cap),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(capacityChannels.changed, handler)
      return () => ipcRenderer.off(capacityChannels.changed, handler)
    },
  },
  signIn: {
    start: (request) => ipcRenderer.invoke(signInChannels.start, request),
    write: (id, data) => ipcRenderer.invoke(signInChannels.write, id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke(signInChannels.resize, id, cols, rows),
    cancel: (id) => ipcRenderer.invoke(signInChannels.cancel, id),
    onData(listener) {
      const handler = (_event: unknown, id: string, data: string) => listener(id, data)
      ipcRenderer.on(signInChannels.data, handler)
      return () => ipcRenderer.off(signInChannels.data, handler)
    },
    onState(listener) {
      const handler = (_event: unknown, id: string, state: SignInState) => listener(id, state)
      ipcRenderer.on(signInChannels.state, handler)
      return () => ipcRenderer.off(signInChannels.state, handler)
    },
  },
  routing: {
    get: () => ipcRenderer.invoke(routingChannels.get),
    setRule: (provider, rule) => ipcRenderer.invoke(routingChannels.setRule, provider, rule),
    setMoveBack: (provider, on) => ipcRenderer.invoke(routingChannels.setMoveBack, provider, on),
    setResumeAtReset: (on) => ipcRenderer.invoke(routingChannels.setResumeAtReset, on),
    setRotateAccounts: (on) => ipcRenderer.invoke(routingChannels.setRotateAccounts, on),
    setPinnedAccount: (provider, accountId) =>
      ipcRenderer.invoke(routingChannels.setPinnedAccount, provider, accountId),
    setEmployeeRule: (employeeId, rule) => ipcRenderer.invoke(routingChannels.setEmployeeRule, employeeId, rule),
    setEmployeePin: (employeeId, provider, accountId) =>
      ipcRenderer.invoke(routingChannels.setEmployeePin, employeeId, provider, accountId),
    addAccount: (provider, label) => ipcRenderer.invoke(routingChannels.addAccount, provider, label),
    renameAccount: (accountId, label) => ipcRenderer.invoke(routingChannels.renameAccount, accountId, label),
    setDefaultAccount: (accountId) => ipcRenderer.invoke(routingChannels.setDefaultAccount, accountId),
    removeAccount: (accountId) => ipcRenderer.invoke(routingChannels.removeAccount, accountId),
    continueNow: (employeeId) => ipcRenderer.invoke(routingChannels.continueNow, employeeId),
    moveBackNow: (employeeId) => ipcRenderer.invoke(routingChannels.moveBackNow, employeeId),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(routingChannels.changed, handler)
      return () => ipcRenderer.off(routingChannels.changed, handler)
    },
  },
  environments: {
    get: () => ipcRenderer.invoke(environmentChannels.get),
    setAskEveryUse: (environment, on) => ipcRenderer.invoke(environmentChannels.setAskEveryUse, environment, on),
    setAvailableToChecks: (environment, on) =>
      ipcRenderer.invoke(environmentChannels.setAvailableToChecks, environment, on),
    add: (input) => ipcRenderer.invoke(environmentChannels.add, input),
    update: (id, patch) => ipcRenderer.invoke(environmentChannels.update, id, patch),
    remove: (id) => ipcRenderer.invoke(environmentChannels.remove, id),
    setRepoDefault: (repoId, environment) =>
      ipcRenderer.invoke(environmentChannels.setRepoDefault, repoId, environment),
    reveal: (id) => ipcRenderer.invoke(environmentChannels.reveal, id),
    copy: (id) => ipcRenderer.invoke(environmentChannels.copy, id),
    pickEnvFile: (environment) => ipcRenderer.invoke(environmentChannels.pickEnvFile, environment),
    importKeys: (environment, names) => ipcRenderer.invoke(environmentChannels.importKeys, environment, names),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(environmentChannels.changed, handler)
      return () => ipcRenderer.off(environmentChannels.changed, handler)
    },
  },
  usage: {
    read: () => ipcRenderer.invoke(usageChannels.read),
    refresh: () => ipcRenderer.invoke(usageChannels.refresh),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(usageChannels.changed, handler)
      return () => ipcRenderer.off(usageChannels.changed, handler)
    },
  },
  answerer: {
    get: () => ipcRenderer.invoke(answererChannels.get),
    set: (employeeId) => ipcRenderer.invoke(answererChannels.set, employeeId),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(answererChannels.changed, handler)
      return () => ipcRenderer.off(answererChannels.changed, handler)
    },
  },
  digest: {
    schedule: () => ipcRenderer.invoke(digestChannels.schedule),
    setSchedule: (update) => ipcRenderer.invoke(digestChannels.setSchedule, update),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(digestChannels.changed, handler)
      return () => ipcRenderer.off(digestChannels.changed, handler)
    },
  },
  approvals: {
    level: () => ipcRenderer.invoke(approvalChannels.level),
    setLevel: (level) => ipcRenderer.invoke(approvalChannels.setLevel, level),
    list: (status) => ipcRenderer.invoke(approvalChannels.list, status),
    decide: (id, decision) => ipcRenderer.invoke(approvalChannels.decide, id, decision),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(approvalChannels.changed, handler)
      return () => ipcRenderer.off(approvalChannels.changed, handler)
    },
  },
  sandbox: {
    read: () => ipcRenderer.invoke(sandboxChannels.read),
    recheck: () => ipcRenderer.invoke(sandboxChannels.recheck),
    setEnabled: (enabled) => ipcRenderer.invoke(sandboxChannels.setEnabled, enabled),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on(sandboxChannels.changed, handler)
      return () => ipcRenderer.off(sandboxChannels.changed, handler)
    },
  },

  rtk: {
    read: () => ipcRenderer.invoke(rtkChannels.read),
    recheck: () => ipcRenderer.invoke(rtkChannels.recheck),
    setEnabled: (enabled) => ipcRenderer.invoke(rtkChannels.setEnabled, enabled),
    setPing: (ping) => ipcRenderer.invoke(rtkChannels.setPing, ping),
    savings: () => ipcRenderer.invoke(rtkChannels.savings),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(rtkChannels.changed, handler)
      return () => ipcRenderer.off(rtkChannels.changed, handler)
    },
  },
  office: {
    facts: () => ipcRenderer.invoke(officeChannels.facts),
    room: () => ipcRenderer.invoke(officeChannels.room),
    setRoom: (slug) => ipcRenderer.invoke(officeChannels.setRoom, slug),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(officeChannels.changed, handler)
      return () => ipcRenderer.off(officeChannels.changed, handler)
    },
  },
  mcp: {
    list: () => ipcRenderer.invoke(mcpChannels.list),
    add: (input) => ipcRenderer.invoke(mcpChannels.add, input),
    update: (id, patch) => ipcRenderer.invoke(mcpChannels.update, id, patch),
    impact: (id) => ipcRenderer.invoke(mcpChannels.impact, id),
    remove: (id) => ipcRenderer.invoke(mcpChannels.remove, id),
    importScan: (provider) => ipcRenderer.invoke(mcpChannels.importScan, provider),
    importServers: (provider, names) => ipcRenderer.invoke(mcpChannels.importServers, provider, names),
    found: () => ipcRenderer.invoke(mcpChannels.found),
    addFound: (source, name) => ipcRenderer.invoke(mcpChannels.addFound, source, name),
    addPreset: (presetId, name, values) => ipcRenderer.invoke(mcpChannels.addPreset, presetId, name, values),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(mcpChannels.changed, handler)
      return () => ipcRenderer.off(mcpChannels.changed, handler)
    },
  },
  skills: {
    list: () => ipcRenderer.invoke(skillChannels.list),
    add: (input) => ipcRenderer.invoke(skillChannels.add, input),
    update: (id, patch) => ipcRenderer.invoke(skillChannels.update, id, patch),
    impact: (id) => ipcRenderer.invoke(skillChannels.impact, id),
    remove: (id) => ipcRenderer.invoke(skillChannels.remove, id),
    pickFolder: () => ipcRenderer.invoke(skillChannels.pickFolder),
    found: () => ipcRenderer.invoke(skillChannels.found),
    addFound: (path) => ipcRenderer.invoke(skillChannels.addFound, path),
    described: () => ipcRenderer.invoke(skillChannels.described),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(skillChannels.changed, handler)
      return () => ipcRenderer.off(skillChannels.changed, handler)
    },
  },
  hiring: {
    teamLoad: () => ipcRenderer.invoke(hiringChannels.teamLoad),
    former: () => ipcRenderer.invoke(hiringChannels.former),
    fire: (employeeId, reason) => ipcRenderer.invoke(hiringChannels.fire, employeeId, reason),
    rehire: (employeeId) => ipcRenderer.invoke(hiringChannels.rehire, employeeId),
    requests: () => ipcRenderer.invoke(hiringChannels.requests),
    updateProposal: (requestId, patch) => ipcRenderer.invoke(hiringChannels.updateProposal, requestId, patch),
    suggestName: (exclude) => ipcRenderer.invoke(hiringChannels.suggestName, exclude),
    headcount: () => ipcRenderer.invoke(hiringChannels.headcount),
    setMaxHeadcount: (max) => ipcRenderer.invoke(hiringChannels.setMaxHeadcount, max),
    setRequestModel: (requestId, model) => ipcRenderer.invoke(hiringChannels.setRequestModel, requestId, model),
  },
  code: {
    list: () => ipcRenderer.invoke(codeChannels.list),
    details: (ticketId) => ipcRenderer.invoke(codeChannels.details, ticketId),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(codeChannels.changed, handler)
      return () => ipcRenderer.off(codeChannels.changed, handler)
    },
  },
  restorePoints: {
    of: (ticketId) => ipcRenderer.invoke(restorePointChannels.of, ticketId),
    losses: (id) => ipcRenderer.invoke(restorePointChannels.losses, id),
    goBack: (id) => ipcRenderer.invoke(restorePointChannels.goBack, id),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(restorePointChannels.changed, handler)
      return () => ipcRenderer.off(restorePointChannels.changed, handler)
    },
  },
  files: {
    places: () => ipcRenderer.invoke(filesChannels.places),
    tree: (placeId) => ipcRenderer.invoke(filesChannels.tree, placeId),
    open: (placeId, path) => ipcRenderer.invoke(filesChannels.open, placeId, path),
    save: (placeId, request) => ipcRenderer.invoke(filesChannels.save, placeId, request),
    create: (placeId, path) => ipcRenderer.invoke(filesChannels.create, placeId, path),
    openInEditor: (placeId, path) => ipcRenderer.invoke(filesChannels.openInEditor, placeId, path),
    reveal: (placeId, path) => ipcRenderer.invoke(filesChannels.reveal, placeId, path),
    changes: () => ipcRenderer.invoke(filesChannels.changes),
    changeDiff: (placeId, path) => ipcRenderer.invoke(filesChannels.changeDiff, placeId, path),
    stage: (placeId, paths) => ipcRenderer.invoke(filesChannels.stage, placeId, paths),
    unstage: (placeId, paths) => ipcRenderer.invoke(filesChannels.unstage, placeId, paths),
    discard: (placeId, paths) => ipcRenderer.invoke(filesChannels.discard, placeId, paths),
    commit: (placeId, message) => ipcRenderer.invoke(filesChannels.commit, placeId, message),
    push: (placeId) => ipcRenderer.invoke(filesChannels.push, placeId),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(filesChannels.changed, handler)
      return () => ipcRenderer.off(filesChannels.changed, handler)
    },
  },
  language: {
    read: (placeId, path, text) => ipcRenderer.invoke(languageChannels.read, placeId, path, text),
    hover: (placeId, path, spot, text) => ipcRenderer.invoke(languageChannels.hover, placeId, path, spot, text),
    definition: (placeId, path, spot, text) =>
      ipcRenderer.invoke(languageChannels.definition, placeId, path, spot, text),
  },
  paths: {
    links: (text) => ipcRenderer.invoke(pathsChannels.links, text),
    open: (path) => ipcRenderer.invoke(pathsChannels.open, path),
    reveal: (path) => ipcRenderer.invoke(pathsChannels.reveal, path),
    openInEditor: (path) => ipcRenderer.invoke(pathsChannels.openInEditor, path),
  },
  editors: {
    get: () => ipcRenderer.invoke(editorsChannels.get),
    choose: (id) => ipcRenderer.invoke(editorsChannels.choose, id),
    onChanged(listener) {
      const handler = (_event: unknown, state: EditorsState) => listener(state)
      ipcRenderer.on(editorsChannels.changed, handler)
      return () => ipcRenderer.off(editorsChannels.changed, handler)
    },
  },
  notifications: {
    enabled: () => ipcRenderer.invoke(notificationChannels.enabled),
    setEnabled: (enabled) => ipcRenderer.invoke(notificationChannels.setEnabled, enabled),
    test: () => ipcRenderer.invoke(notificationChannels.test),
    delivery: () => ipcRenderer.invoke(notificationChannels.delivery),
    openSystemSettings: () => ipcRenderer.invoke(notificationChannels.openSystemSettings),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(notificationChannels.changed, handler)
      return () => ipcRenderer.off(notificationChannels.changed, handler)
    },
    onFocus(listener) {
      const handler = (_event: unknown, request: NotificationFocusRequest) => listener(request)
      ipcRenderer.on(notificationChannels.focus, handler)
      return () => ipcRenderer.off(notificationChannels.focus, handler)
    },
  },
  planning: {
    list: () => ipcRenderer.invoke(planningChannels.list),
    versions: (subject) => ipcRenderer.invoke(planningChannels.versions, subject),
    answer: (questionId, text) => ipcRenderer.invoke(planningChannels.answer, questionId, text),
    delegate: (questionId) => ipcRenderer.invoke(planningChannels.delegate, questionId),
    approve: (planId) => ipcRenderer.invoke(planningChannels.approve, planId),
    requestChanges: (planId, comments) => ipcRenderer.invoke(planningChannels.requestChanges, planId, comments),
    keep: (planId) => ipcRenderer.invoke(planningChannels.keep, planId),
    replan: (ticketId, reason) => ipcRenderer.invoke(planningChannels.replan, ticketId, reason),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(planningChannels.changed, handler)
      return () => ipcRenderer.off(planningChannels.changed, handler)
    },
  },
  buildStyle: {
    get: () => ipcRenderer.invoke(buildStyleChannels.get),
    set: (style) => ipcRenderer.invoke(buildStyleChannels.set, style),
  },
  caveman: {
    get: () => ipcRenderer.invoke(cavemanChannels.get),
    set: (level) => ipcRenderer.invoke(cavemanChannels.set, level),
  },
  spawnSettings: {
    stale: () => ipcRenderer.invoke(spawnSettingsChannels.stale),
    applyNow: () => ipcRenderer.invoke(spawnSettingsChannels.applyNow),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(spawnSettingsChannels.changed, handler)
      return () => ipcRenderer.off(spawnSettingsChannels.changed, handler)
    },
  },
  voice: {
    colleague: () => ipcRenderer.invoke(voiceChannels.colleague),
    setColleague: (voice) => ipcRenderer.invoke(voiceChannels.setColleague, voice),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(voiceChannels.changed, handler)
      return () => ipcRenderer.off(voiceChannels.changed, handler)
    },
  },
  reviews: {
    list: () => ipcRenderer.invoke(reviewChannels.list),
    approve: (ticketId, comments) => ipcRenderer.invoke(reviewChannels.approve, ticketId, comments),
    requestChanges: (ticketId, comments) => ipcRenderer.invoke(reviewChannels.requestChanges, ticketId, comments),
    diff: (ticketId) => ipcRenderer.invoke(reviewChannels.diff, ticketId),
    fileSides: (ticketId, repoId, path) => ipcRenderer.invoke(reviewChannels.fileSides, ticketId, repoId, path),
    comments: (ticketId) => ipcRenderer.invoke(reviewChannels.comments, ticketId),
    comment: (input) => ipcRenderer.invoke(reviewChannels.comment, input),
    threads: (ticketId) => ipcRenderer.invoke(reviewChannels.threads, ticketId),
    openThread: (input) => ipcRenderer.invoke(reviewChannels.openThread, input),
    replyInThread: (threadId, body) => ipcRenderer.invoke(reviewChannels.replyInThread, threadId, body),
    setThreadState: (threadId, state) => ipcRenderer.invoke(reviewChannels.setThreadState, threadId, state),
    threadsOnForge: (ticketId) => ipcRenderer.invoke(reviewChannels.threadsOnForge, ticketId),
    roundLimit: () => ipcRenderer.invoke(reviewChannels.roundLimit),
    setRoundLimit: (rounds) => ipcRenderer.invoke(reviewChannels.setRoundLimit, rounds),
    securityPasses: () => ipcRenderer.invoke(reviewChannels.securityPasses),
    overrideSecurity: (ticketId, reason) => ipcRenderer.invoke(reviewChannels.securityOverride, ticketId, reason),
    securityScope: () => ipcRenderer.invoke(reviewChannels.securityScope),
    setSecurityScope: (scope) => ipcRenderer.invoke(reviewChannels.setSecurityScope, scope),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(reviewChannels.changed, handler)
      return () => ipcRenderer.off(reviewChannels.changed, handler)
    },
  },
  tests: {
    of: (ticketId) => ipcRenderer.invoke(testChannels.of, ticketId),
    list: () => ipcRenderer.invoke(testChannels.list),
    addStep: (ticketId, title, detail) => ipcRenderer.invoke(testChannels.addStep, ticketId, title, detail),
    setStep: (stepId, result, note) => ipcRenderer.invoke(testChannels.setStep, stepId, result, note),
    attach: (stepId, files) => ipcRenderer.invoke(testChannels.attach, stepId, files),
    capture: (stepId, ticketId, repoId) => ipcRenderer.invoke(testChannels.capture, stepId, ticketId, repoId),
    openAttachment: (id) => ipcRenderer.invoke(testChannels.openAttachment, id),
    pass: (ticketId) => ipcRenderer.invoke(testChannels.pass, ticketId),
    reportBug: (ticketId, note) => ipcRenderer.invoke(testChannels.reportBug, ticketId, note),
    runnable: (ticketId) => ipcRenderer.invoke(testChannels.runnable, ticketId),
    startApp: (ticketId, repoId) => ipcRenderer.invoke(testChannels.startApp, ticketId, repoId),
    stopApp: (ticketId, repoId) => ipcRenderer.invoke(testChannels.stopApp, ticketId, repoId),
    appLog: (ticketId, repoId) => ipcRenderer.invoke(testChannels.appLog, ticketId, repoId),
    settings: () => ipcRenderer.invoke(testChannels.settings),
    setMode: (mode) => ipcRenderer.invoke(testChannels.setMode, mode),
    setRepo: (repoId, changes) => ipcRenderer.invoke(testChannels.setRepo, repoId, changes),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(testChannels.changed, handler)
      return () => ipcRenderer.off(testChannels.changed, handler)
    },
  },
  shell: {
    platform: process.platform,
    toggleMaximize: () => ipcRenderer.invoke(shellChannels.toggleMaximize),
    onCloseRequest(listener) {
      const handler = () => listener()
      ipcRenderer.on(shellChannels.closeRequest, handler)
      return () => ipcRenderer.off(shellChannels.closeRequest, handler)
    },
    onMenuCommand(listener) {
      const handler = (_event: unknown, command: MenuCommand) => listener(command)
      ipcRenderer.on(shellChannels.menuCommand, handler)
      return () => ipcRenderer.off(shellChannels.menuCommand, handler)
    },
  },
  keepAwake: {
    get: () => ipcRenderer.invoke(keepAwakeChannels.get),
    setMode: (mode) => ipcRenderer.invoke(keepAwakeChannels.setMode, mode),
    onChanged(listener) {
      const handler = (_event: unknown, state: KeepAwakeState) => listener(state)
      ipcRenderer.on(keepAwakeChannels.changed, handler)
      return () => ipcRenderer.off(keepAwakeChannels.changed, handler)
    },
  },
  onboarding: {
    progress: () => ipcRenderer.invoke(onboardingChannels.progress),
    save: (draft) => ipcRenderer.invoke(onboardingChannels.save, draft),
    finish: (input) => ipcRenderer.invoke(onboardingChannels.finish, input),
  },
  activity: {
    list: (query) => ipcRenderer.invoke(activityChannels.list, query),
    actors: () => ipcRenderer.invoke(activityChannels.actors),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(activityChannels.changed, handler)
      return () => ipcRenderer.off(activityChannels.changed, handler)
    },
  },
  windows: {
    machine: () => ipcRenderer.invoke(windowsChannels.machine),
    recheck: () => ipcRenderer.invoke(windowsChannels.recheck),
  },
  crash: {
    platform: process.platform,
    record: (report) => ipcRenderer.invoke(crashChannels.record, report),
  },
  updates: {
    get: () => ipcRenderer.invoke(updateChannels.get),
    checkNow: () => ipcRenderer.invoke(updateChannels.checkNow),
    openDownloadPage: () => ipcRenderer.invoke(updateChannels.openDownloadPage),
    onChanged(listener) {
      const handler = (_event: unknown, state: UpdateState) => listener(state)
      ipcRenderer.on(updateChannels.changed, handler)
      return () => ipcRenderer.off(updateChannels.changed, handler)
    },
  },
  profile: {
    get: () => ipcRenderer.invoke(profileChannels.get),
    update: (update) => ipcRenderer.invoke(profileChannels.update, update),
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(profileChannels.changed, handler)
      return () => ipcRenderer.off(profileChannels.changed, handler)
    },
  },
  preflight: {
    status: () => ipcRenderer.invoke(preflightChannels.status),
    all: () => ipcRenderer.invoke(preflightChannels.all),
    recheck: () => ipcRenderer.invoke(preflightChannels.recheck),
    onChanged(listener) {
      const handler = (_event: unknown, preflight: ProviderPreflight[]) => listener(preflight)
      ipcRenderer.on(preflightChannels.changed, handler)
      return () => ipcRenderer.off(preflightChannels.changed, handler)
    },
  },
}

contextBridge.exposeInMainWorld('tinyCorp', api)
