// 单元用例 - 粘贴「先插入后就地替换」的纯逻辑
import { describe, it, expect } from 'vitest'
import { computeInsertionRange, applySanitized, normalizeNewlines, exceedsPasteLimit, MAX_PASTE_CHARS } from '../../src/content/pasteText'

describe('normalizeNewlines', () => {
  it('CRLF → LF（Windows 剪贴板多行文本的常见形态）', () => {
    expect(normalizeNewlines('a\r\nb\r\nc')).toBe('a\nb\nc')
  })

  it('孤立 CR → LF（旧 Mac 形态）', () => {
    expect(normalizeNewlines('a\rb')).toBe('a\nb')
  })

  it('LF 与无换行保持不变', () => {
    expect(normalizeNewlines('a\nb')).toBe('a\nb')
    expect(normalizeNewlines('single line')).toBe('single line')
  })

  it('混合形态逐一归一化', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('computeInsertionRange', () => {
  it('末尾追加：区间为粘贴文本本身', () => {
    const value = 'prefix sk-abc123'
    const pasted = 'sk-abc123'
    expect(computeInsertionRange(value, value.length, pasted)).toEqual({
      start: 'prefix '.length,
      end: value.length
    })
  })

  it('替换选区：区间从原选区起点开始', () => {
    const before = 'hello world'
    const pasted = 'sk-abc'
    const value = 'hello sk-abc' // 选中 world 并粘贴
    const range = computeInsertionRange(value, 'hello sk-abc'.length, pasted)
    expect(range).toEqual({ start: 6, end: 12 })
    expect(value.slice(range!.start, range!.end)).toBe(pasted)
    expect(before.slice(0, 6)).toBe('hello ')
  })

  it('中间插入：光标位置正确反推起点', () => {
    const value = 'aaask-secretbb'
    const pasted = 'k-secret' // 出现在 [4, 12)
    expect(computeInsertionRange(value, 12, pasted)).toEqual({ start: 4, end: 12 })
  })

  it('站点改写了粘贴内容（值与剪贴板不吻合）→ null 放弃改写', () => {
    expect(computeInsertionRange('aaaXXX', 6, 'sk-abc')).toBeNull()
  })

  it('空粘贴 / 光标越界 / 光标无法容纳粘贴长度 → null', () => {
    expect(computeInsertionRange('abc', 3, '')).toBeNull()
    expect(computeInsertionRange('abc', 99, 'x')).toBeNull()
    expect(computeInsertionRange('abc', -1, 'x')).toBeNull()
    expect(computeInsertionRange('ab', 1, 'abcdef')).toBeNull()
  })

  it('多字节字符（emoji）按 UTF-16 长度参与运算', () => {
    const pasted = '🙂sk-1'
    const value = `head ${pasted}`
    const range = computeInsertionRange(value, value.length, pasted)
    expect(range).toEqual({ start: 5, end: value.length })
    expect(value.slice(range!.start, range!.end)).toBe(pasted)
  })

  it('回归：CRLF 多行粘贴（剪贴板 \r\n / textarea 已归一化为 \n）→ 匹配成功', () => {
    // 模拟 Windows 剪贴板：原始文本带 \r\n；textarea.value 已按规范归一化为 \n
    const pastedRaw = '手机13812345678\r\n邮箱test@example.com'
    const pastedInValue = normalizeNewlines(pastedRaw) // textarea 内实际形态
    const value = `前缀\n${pastedInValue}\n后缀`
    const caret = ('前缀\n' + pastedInValue).length

    const range = computeInsertionRange(value, caret, pastedRaw)
    expect(range).not.toBeNull()
    expect(value.slice(range!.start, range!.end)).toBe(pastedInValue)
  })

  it('回归：归一化后光标容纳不下（粘贴全文为空白换行）→ null', () => {
    expect(computeInsertionRange('ab', 1, '\r\n')).toBeNull()
  })
})

describe('applySanitized', () => {
  const value = 'head sk-abc tail'
  const range = { start: 5, end: 11 }

  it('按区间替换为脱敏结果', () => {
    expect(applySanitized(value, range, '<<API_KEY:0>>', 'sk-abc')).toBe('head <<API_KEY:0>> tail')
  })

  it('脱敏结果为空串（整段删除）也允许', () => {
    expect(applySanitized(value, range, '', 'sk-abc')).toBe('head  tail')
  })

  it('区间内容被改写（用户在粘贴段内继续输入）→ null 放弃改写', () => {
    const mutated = 'head sk-aXbc tail' // 在粘贴段中间插了一个字符
    expect(applySanitized(mutated, range, '<<API_KEY:0>>', 'sk-abc')).toBeNull()
  })

  it('区间越界 → null', () => {
    expect(applySanitized(value, { start: -1, end: 3 }, 'x', 'sk-abc')).toBeNull()
    expect(applySanitized(value, { start: 5, end: 999 }, 'x', 'sk-abc')).toBeNull()
  })
})

describe('exceedsPasteLimit（超长粘贴真放行守卫）', () => {
  it('恰好等于上限仍正常处理', () => {
    expect(exceedsPasteLimit('a'.repeat(MAX_PASTE_CHARS))).toBe(false)
  })

  it('超过上限即放行（入口层不发检测消息，防 SW 截断改写吞尾）', () => {
    expect(exceedsPasteLimit('a'.repeat(MAX_PASTE_CHARS + 1))).toBe(true)
  })
})
