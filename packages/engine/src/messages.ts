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
// SW → 注入挂件：侧栏开/关的实时推送（SW 转发 Chrome 141+ 的 sidePanel.onOpened /
// 142+ 的 onClosed）。只带 panelOpen 一个字段——挂件其余状态由轮询负责，
// 旧浏览器没有这两个事件时，2s 轮询照常兜底。
export const SITE_AI_PANEL_STATE = 'SITE_AI_PANEL_STATE'

export interface SiteAiPanelStatePush {
  type: typeof SITE_AI_PANEL_STATE
  panelOpen: boolean
}

export interface SiteAiState {
  /** 站点模式（https://host/*），由 SW 从 sender.url 推导并回传 */
  pattern: string
  globalEnabled: boolean
  siteEnabled: boolean
  hostReady: boolean
  /** 该标签页的侧边栏当前是否开着；浏览器查不到（无 getContexts）时缺省 */
  panelOpen?: boolean
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
