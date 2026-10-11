import type { RunnerConfig } from '../config'
import { ClaudeAdapter } from './claude'
import { CodexAdapter } from './codex'
import type { AgentAdapter } from './types'

/** The adapters this runner is configured for. A provider missing from the config isn't offered. */
export function buildAdapters(config: RunnerConfig): AgentAdapter[] {
  const adapters: AgentAdapter[] = []
  const claude = config.providers.claude_code
  const codex = config.providers.codex
  if (claude)
    adapters.push(new ClaudeAdapter({ bin: claude.bin, maxBudgetUsd: claude.maxBudgetUsd }))
  if (codex) adapters.push(new CodexAdapter({ bin: codex.bin, codexHome: config.codexHome }))
  return adapters
}
