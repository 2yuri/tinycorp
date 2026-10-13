import { signInChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { SignInRequest } from '../../../shared/usage/sign-in'
import { attempt, type IpcHandlerRegistry, isRecord, requireString } from '../../core'
import type { SignIns } from './sign-in'

export interface SignInIpcOptions {
  ipc: IpcHandlerRegistry
  signIns: SignIns
}

/**
 * The sign-in modal's terminal (T263). What crosses is what the product prints and what the boss
 * types — the same traffic an Employee's terminal carries — and never a credential: the product
 * writes the login itself, and TinyCorp only notices that it did.
 */
export function registerSignInIpc({ ipc, signIns }: SignInIpcOptions): void {
  ipc.handle(signInChannels.start, (_event, request) => settle(() => signIns.start(parseRequest(request))))
  ipc.handle(signInChannels.write, (_event, id, data) =>
    attempt(() => signIns.write(requireString(id, 'the sign-in'), input(data))),
  )
  ipc.handle(signInChannels.resize, (_event, id, cols, rows) =>
    attempt(() => signIns.resize(requireString(id, 'the sign-in'), cells(cols), cells(rows))),
  )
  ipc.handle(signInChannels.cancel, (_event, id) => attempt(() => signIns.cancel(requireString(id, 'the sign-in'))))
}

function parseRequest(value: unknown): SignInRequest {
  if (!isRecord(value)) throw new Error('A sign-in names a Provider')
  const accountId = value['accountId']
  return {
    provider: requireString(value['provider'], 'the Provider'),
    accountId: accountId === null || accountId === undefined ? null : requireString(accountId, 'the account'),
  }
}

/** What the boss typed. A keystroke may be anything, but it is text. */
function input(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Terminal input is text')
  return value
}

/** A terminal size, in whole cells. */
function cells(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error('A terminal size is a whole number of cells')
  }
  return value
}

async function settle<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
