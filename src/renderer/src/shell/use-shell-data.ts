import { useMemo } from 'react'
import { bossInboxUnread, bossInboxUnreadByChannel } from '../../../shared/inbox/boss-inbox'
import { waitsOnBoss } from '../../../shared/planning/planning'
import { resources, useIpcResource } from '../ipc'
import { EMPTY_SHELL_DATA, type ShellData } from './nav-model'

/**
 * The current Company's data behind the sidebar, from the channels the screens themselves read.
 *
 * It used to be twelve reads of its own behind seven subscriptions, refreshed whole whenever any of
 * them fired (T212); now a staff change reads the staff, and the board the sidebar draws is the same
 * board the board screen drew.
 */
export function useShellData(companyId: string | null): ShellData {
  const employees = useIpcResource(resources.employees)
  const roles = useIpcResource(resources.roles)
  const channels = useIpcResource(resources.channels)
  const agentPairs = useIpcResource(resources.agentPairs)
  const unread = useIpcResource(resources.unreadByChannel)
  const drafted = useIpcResource(resources.draftedChannels)
  const inbox = useIpcResource(resources.bossInbox)
  const board = useIpcResource(resources.board)
  const repos = useIpcResource(resources.repos)
  const code = useIpcResource(resources.code)
  const pending = useIpcResource(resources.pendingApprovals)
  const plans = useIpcResource(resources.plans)
  const autonomy = useIpcResource(resources.autonomy)
  const memory = useIpcResource(resources.memoryCounts)

  return useMemo(
    () =>
      companyId === null
        ? EMPTY_SHELL_DATA
        : {
            employees,
            roles,
            channels,
            agentPairs,
            unread: unread.counts,
            drafted,
            bossInboxUnread: bossInboxUnread(inbox),
            // The pill on each line, from the rows the Inbox row above them counts (T251).
            needsYou: bossInboxUnreadByChannel(inbox),
            board,
            repos,
            code,
            // A plan waiting on the boss is one of the rows My approvals lists, so it is one of
            // the decisions the row counts: before T233 the count and the list disagreed.
            pendingApprovals: pending.length + plans.filter(waitsOnBoss).length,
            autonomy: autonomy ?? EMPTY_SHELL_DATA.autonomy,
            memoryPages: memory.pages,
          },
    [
      companyId,
      employees,
      roles,
      channels,
      agentPairs,
      unread,
      drafted,
      inbox,
      board,
      repos,
      code,
      pending,
      plans,
      autonomy,
      memory,
    ],
  )
}
