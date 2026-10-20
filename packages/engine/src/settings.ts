// 扩展设置的存储键与判定（侧栏 / SW / 页面挂件共用）
//
// 单独成文件是为了让键名只有一个来源：侧栏 store、SW 的有效 AI 判定、站点挂件
// 的逐站开关都读同一套键。语义见 docs/design/site-ai-offscreen-host.md §4。

/** 全局 AI 开关（语义：允许使用 AI；默认 false） */
export const AI_ENABLED_KEY = 'contextwatchdog.aiEnabled'

/** 逐站 AI 开关：Record<pattern, boolean>，缺省 = 关闭 */
export const SITE_AI_ENABLED_KEY = 'contextwatchdog.siteAiEnabled'

/**
 * 有效 AI = 全局允许 ∧ 本站开启 ∧ 宿主就绪。
 * 三个条件缺一不可：任何一层没准备好都必须退回正则档（AI 是增量，不是前提）。
 */
export const isEffectiveAI = (input: {
  globalEnabled: boolean
  siteEnabled: boolean
  hostReady: boolean
}): boolean => input.globalEnabled && input.siteEnabled && input.hostReady

/**
 * 读取 Record<string, boolean>（storage 异常 / 脏数据一律按空表处理）。
 * 只保留值为 true 的键：缺省即 false，写回时不必留一堆 false。
 */
export const readBooleanMap = async (key: string): Promise<Record<string, boolean>> => {
  try {
    const result = await chrome.storage.local.get(key)
    const stored = result[key]
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    const out: Record<string, boolean> = {}
    for (const [entryKey, value] of Object.entries(stored)) {
      if (value === true) out[entryKey] = true
    }
    return out
  } catch {
    return {}
  }
}
