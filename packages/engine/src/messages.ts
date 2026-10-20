// content script ↔ service worker 的消息契约

// 粘贴文本送检（content script → SW）
export const PASTE_DETECT = 'PASTE_DETECT'

export interface PasteDetectRequest {
  type: typeof PASTE_DETECT
  text: string
}

// SW 回传脱敏结果（content script 只用 sanitized 字段做就地替换）
export interface PasteDetectResponse {
  ok: boolean
  sanitized?: string
  count?: number
  error?: string
}

// ---------- 站点挂件（content script / 注入函数 ↔ SW） ----------

// 读取本站状态（全局开关 / 逐站开关 / 宿主是否就绪 / 挂件是否被隐藏）
export const SITE_AI_GET = 'SITE_AI_GET'
// 写入逐站开关
export const SITE_AI_SET = 'SITE_AI_SET'
// 隐藏本站挂件
export const SITE_WIDGET_HIDE = 'SITE_WIDGET_HIDE'
// 从页面打开侧边栏
export const OPEN_SIDE_PANEL = 'OPEN_SIDE_PANEL'

export interface SiteAiState {
  /** 站点模式（https://host/*），由 SW 从 sender.url 推导并回传 */
  pattern: string
  globalEnabled: boolean
  siteEnabled: boolean
  hostReady: boolean
  widgetHidden: boolean
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
