import { useMemo } from 'react'
import type { Approval } from '../../../shared/approvals'
import { resources, useIpcResource } from '../ipc'

/** Every Approval of the current Company by the id of its thread's root message, kept live. */
export function useApprovalThreads(): Map<number, Approval> {
  const approvals = useIpcResource(resources.approvals)
  return useMemo(() => new Map(approvals.map((approval) => [approval.messageId, approval])), [approvals])
}
