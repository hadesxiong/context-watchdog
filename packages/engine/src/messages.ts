// content script ↔ service worker 的消息契约

// 粘贴文本送检（content script → SW）
export const PASTE_DETECT = 'PASTE_DETECT'

export interface PasteDetectRequest {
  type: typeof PASTE_DETECT
  text: string
  /**
   * 一次粘贴链路的标识。带上它 = 请求 SW 在正则结果回包后，
   * 若本站 AI 生效再异步发一条 PASTE_AI_RESULT（不带则行为与旧版一致）。
   */
  token?: string
}

// SW → content script：AI 二次升级结果（正则结果已经先落地）
export const PASTE_AI_RESULT = 'PASTE_AI_RESULT'

export interface PasteAiResult {
  type: typeof PASTE_AI_RESULT
  token: string
  sanitized: string
  count: number
}

// SW 回传脱敏结果（content script 只用 sanitized 字段做就地替换）
export interface PasteDetectResponse {
  ok: boolean
  sanitized?: string
  count?: number
  error?: string
}

// ---------- 站点挂件（content script / 注入函数 ↔ SW） ----------

// 读取本站状态（全局开关 / 逐站开关 / 宿主是否就绪）
export const SITE_AI_GET = 'SITE_AI_GET'
// 写入逐站开关
export const SITE_AI_SET = 'SITE_AI_SET'
// 从页面打开侧边栏
export const OPEN_SIDE_PANEL = 'OPEN_SIDE_PANEL'

export interface SiteAiState {
  /** 站点模式（https://host/*），由 SW 从 sender.url 推导并回传 */
  pattern: string
  globalEnabled: boolean
  siteEnabled: boolean
  hostReady: boolean
}

export interface SiteAiGetResponse {
  ok: boolean
  state?: SiteAiState
  error?: string
}

export interface SiteAiSetResponse {
  ok: boolean
  error?: string
}
