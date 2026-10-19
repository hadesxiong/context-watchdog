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
