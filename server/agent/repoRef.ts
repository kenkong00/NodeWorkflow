/**
 * 让 agent 模块拿到 apiPlugin 里初始化好的仓库实例（避免循环依赖）。
 */
import type { LLMProviderRepo } from '../repositories/LLMProviderRepo'

let repo: LLMProviderRepo | null = null

export function setLLMRepo(r: LLMProviderRepo): void {
  repo = r
}

export function llmRepoRef(): LLMProviderRepo {
  if (!repo) throw new Error('LLMProviderRepo 尚未初始化')
  return repo
}
