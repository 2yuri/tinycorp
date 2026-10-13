import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * A tool's JSON result, or its error message as a tool error.
 *
 * The MCP twin of `attempt` in `ipc-kit.ts`: every tool an Employee calls answers through here, so
 * a thrown refusal reaches the Employee as something it can read and act on rather than as a
 * transport error. It lived in the chat tools until T188, where six other features were reaching
 * into chat for it.
 */
export function run(action: () => unknown): CallToolResult {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(action()) }] }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    }
  }
}
