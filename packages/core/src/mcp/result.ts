import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { AppError } from '../errors'

const HINT: Partial<Record<AppError['code'], string>> = {
  ambiguous_ref: 'Call again with the full path (Parent > Child) or the id.',
  not_found: 'Check names with get_board (format "compact").',
  forbidden: "Your role in this project doesn't allow this. Ask a project owner.",
  validation_error: 'Nothing was saved. Fix every listed problem and call again.',
}

export function ok(data: unknown): CallToolResult {
  const structured = Array.isArray(data) ? { items: data } : (data as Record<string, unknown>)
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: structured }
}

/** Maps service errors to MCP tool errors the model can act on. */
export function fail(e: unknown): CallToolResult {
  if (e instanceof AppError) {
    const lines = [`${e.code}: ${e.message}`]
    const details = e.details as
      { errors?: { index: number; message: string; details?: unknown }[] } | undefined
    for (const err of details?.errors ?? []) {
      lines.push(
        `- change ${err.index}: ${err.message}${err.details ? ` ${JSON.stringify(err.details)}` : ''}`,
      )
    }
    const hint = HINT[e.code]
    if (hint) lines.push(hint)
    return { isError: true, content: [{ type: 'text', text: lines.join('\n') }] }
  }
  return {
    isError: true,
    content: [{ type: 'text', text: 'internal: Something went wrong on the Stagegrid server.' }],
  }
}

export async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn())
  } catch (e) {
    return fail(e)
  }
}
