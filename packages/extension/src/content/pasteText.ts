// 粘贴「先插入后就地替换」的纯逻辑（供单测）。运行时的内联副本见
// src/background/pasteEntryPoint.ts（注入函数必须自包含，无法 import），改动需两边同步。

export interface InsertionRange {
  start: number
  end: number
}

// 换行归一化：textarea.value 按规范把 \r\n / \r 归一化为 \n，而剪贴板（尤其 Windows）
// 常带 \r\n——不归一会让多行粘贴的逐字校验必然失配，整条链路静默失效
export const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n?/g, '\n')

// 插入区间 = 粘贴后光标位置 - 粘贴文本长度；与实际不吻合（站点改写 / IME / 并发输入）则返回 null，调用方放弃改写
export const computeInsertionRange = (
  value: string,
  caret: number,
  pasted: string
): InsertionRange | null => {
  const expected = normalizeNewlines(pasted)
  if (!expected || caret < 0 || caret > value.length) return null
  const start = caret - expected.length
  if (start < 0) return null
  if (value.slice(start, caret) !== expected) return null
  return { start, end: caret }
}

// 用脱敏结果替换区间；区间内容与原文不符（用户在检测期间继续输入）返回 null 放弃改写
export const applySanitized = (
  value: string,
  range: InsertionRange,
  sanitized: string,
  expected: string
): string | null => {
  if (range.start < 0 || range.end > value.length) return null
  if (value.slice(range.start, range.end) !== expected) return null
  return value.slice(0, range.start) + sanitized + value.slice(range.end)
}

// 超长粘贴守卫上限（与 service-worker.ts / pasteEntryPoint.ts 的 MAX_PASTE_CHARS 一致）。
// 入口层直接放行才是真守卫：SW 仅对检测范围 slice，入口照单全收会让超限粘贴被「截断后的
// 脱敏结果」整体改写、尾部被静默吞掉
export const MAX_PASTE_CHARS = 20000

export const exceedsPasteLimit = (text: string): boolean => text.length > MAX_PASTE_CHARS

// ---------- AI 二次升级守卫（定义见 docs/site-ai-offscreen-host.md §3.5 P6） ----------
// 正则结果先落地，AI 是增量：任一守卫不通过都**保留正则结果**，绝不回退原文、也绝不把
// AI 的部分结果拼到已经变化的输入框里。注入函数里有等价的内联副本，改动需两边同步。

export const AI_UPGRADE_TTL = 8000

export interface AiUpgradeSnapshot {
  /** 一次粘贴链路的标识（PASTE_DETECT 带出、PASTE_AI_RESULT 带回） */
  token: string
  /** 正则脱敏结果（已写入输入框的内容） */
  appliedText: string
  range: InsertionRange
  /** 正则结果落地后的完整 value（用于判断用户是否继续输入） */
  valueAfterApply: string
  appliedAt: number
}

export interface AiUpgradeInput {
  snapshot: AiUpgradeSnapshot
  /** 收到 AI 结果时的 value */
  currentValue: string
  currentCaret: number
  /** AI（正则 + 模型）重新检测后的脱敏文本 */
  aiSanitized: string
  /** 总脱敏处数（含正则命中） */
  aiCount: number
  now: number
}

export type AiUpgradePlan =
  | { ok: true; value: string; caret: number; count: number }
  | { ok: false; reason: 'value-changed' | 'range-moved' | 'no-increment' | 'expired' }

/**
 * 判断 AI 结果能否安全替换正则结果。
 * 返回 ok=true 时给出替换后的完整 value、修正后的光标与总处数。
 */
export const planAiUpgrade = (input: AiUpgradeInput): AiUpgradePlan => {
  const { snapshot, currentValue, currentCaret, aiSanitized, aiCount, now } = input
  const { range, appliedText } = snapshot

  // a) 用户没继续输入
  if (currentValue !== snapshot.valueAfterApply) return { ok: false, reason: 'value-changed' }
  // b) 正则结果仍在原位（区间越界或内容不符都算漂移）
  if (range.start < 0 || range.end > currentValue.length) return { ok: false, reason: 'range-moved' }
  if (currentValue.slice(range.start, range.end) !== appliedText) {
    return { ok: false, reason: 'range-moved' }
  }
  // c) AI 确有增量（相同则不做无意义替换）
  if (aiSanitized === appliedText) return { ok: false, reason: 'no-increment' }
  // d) 超过 TTL 的 AI 结果直接丢弃，避免用户已继续操作后被回写
  if (now - snapshot.appliedAt > AI_UPGRADE_TTL) return { ok: false, reason: 'expired' }

  const delta = aiSanitized.length - appliedText.length
  const mappedCaret =
    currentCaret <= range.start
      ? currentCaret
      : currentCaret >= range.end
        ? currentCaret + delta
        : range.start + aiSanitized.length

  const value =
    currentValue.slice(0, range.start) + aiSanitized + currentValue.slice(range.end)

  return {
    ok: true,
    value,
    caret: Math.max(0, Math.min(mappedCaret, value.length)),
    count: aiCount
  }
}
