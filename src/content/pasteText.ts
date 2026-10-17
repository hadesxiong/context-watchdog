// 粘贴「先插入后就地替换」的纯逻辑（供单测）
// 运行时的内联副本见 src/background/pasteEntryPoint.ts（注入函数必须自包含，无法 import），
// 改动需两边同步。

export interface InsertionRange {
  start: number
  end: number
}

// 换行归一化：textarea.value 按 HTML 规范把 \r\n / \r 归一化为 \n，
// 而剪贴板原始文本（尤其 Windows）常带 \r\n——不归一化会导致多行粘贴的
// 逐字校验必然失配（长度与内容双重偏差），整条检测链路静默失效
export const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n?/g, '\n')

// 粘贴插入区间：粘贴后光标位置 - 粘贴文本长度。
// 与实际值不吻合（站点改写粘贴内容 / IME / 并发输入）则返回 null，调用方放弃改写
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
