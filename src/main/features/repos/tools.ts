import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CHECK_KEYS, STACK_KEYS, type StackConstraints } from '../../../shared/repos/repo'
import { run } from '../../core'
import type { McpCaller } from '../../core/engine'

const FIELD_HELP: Record<keyof StackConstraints, string> = {
  language: 'Main language, such as TypeScript.',
  framework: 'Main framework, such as React.',
  packageManager: 'Package manager, such as pnpm.',
  packageManagerVersion: 'Package manager version, such as 9.',
  install: 'Command that installs dependencies.',
  build: 'Command that builds the project.',
  test: 'Command that runs the tests.',
  lint: 'Command that lints the project.',
}

/**
 * `repo_set_checks`: the Employee who sets a project up records its Checks and stack facts
 * (decision 40). Only the fields given change; the change is announced in `#tech`.
 */
export function registerRepoTools(server: McpServer, { employee, chat, repos, setRepoChecks }: McpCaller): void {
  const fields = Object.fromEntries(
    STACK_KEYS.map((key) => [key, z.string().optional().describe(`${FIELD_HELP[key]} Empty clears it.`)]),
  ) as Record<keyof StackConstraints, z.ZodOptional<z.ZodString>>

  server.registerTool(
    'repo_set_checks',
    {
      description:
        'Record a repo’s checks (install, build, test, lint) and stack facts once you have set the project up. ' +
        'Only the fields you give change. Everyone runs the checks before opening a PR; a note goes to #tech.',
      inputSchema: {
        repo: z.string().describe('The repo’s name (or id).'),
        ...fields,
      },
    },
    ({ repo, ...given }) =>
      run(() => {
        const wanted = repo.trim()
        const target = repos().find((r) => r.id === wanted || r.name.toLowerCase() === wanted.toLowerCase())
        if (!target) throw new Error(`No repo is called ${repo}`)
        const changes: Partial<StackConstraints> = {}
        for (const key of STACK_KEYS) if (given[key] !== undefined) changes[key] = given[key]
        if (Object.keys(changes).length === 0) throw new Error('Give at least one check or stack field to set')
        const updated = setRepoChecks(target.id, changes)
        const checks = CHECK_KEYS.filter((key) => updated.stack[key] !== '')
          .map((key) => `${key} \`${updated.stack[key]}\``)
          .join(', ')
        chat.post({
          authorId: employee.id,
          channelId: 'tech',
          text: `Updated the checks of ${updated.name}: ${checks || 'none set'}.`,
        })
        return { repo: updated.name, ...updated.stack }
      }),
  )
}
