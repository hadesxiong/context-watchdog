// 中文混排偏移验证 - GLiNER 偏移体系风险的正则侧契约
// span 必须与 original 严格一致，否则替换会错位切字
import { describe, it, expect } from 'vitest'
import { runDetect, applyReplace, assertSpansConsistent, assertNoOverlap } from '../helpers'

const CJK_CASES = [
  '中文前缀手机号 13812345678 后缀中文',
  '密码：hunter2密码（注意全角冒号）',
  '【重要】请联系 138-1234-5678 或 010-87654321',
  'mixed中文andEnglish混合 11010519491231002X 测试',
  '多行中文\n第二行有 4532015112830366 卡号\n第三行 京A12345',
  'emoji 混排 🎉 手机 13812345678 🎉 结束',
  '全角数字：１3812345678 不应误报为手机号（全角1）', // 全角 １ 是 U+FF11，\d 在 JS 中匹配！记录现状
  '制表符\t分隔 13812345678\t结束'
]

describe('CJK 混排偏移', () => {
  for (const [idx, text] of CJK_CASES.entries()) {
    it(`Case ${idx + 1}: span 与 original 一致`, async () => {
      const { items } = await runDetect(text)
      assertSpansConsistent(text, items)
      assertNoOverlap(items)
    })
  }

  it('替换输出中占位符配对完好（无错位切字）', async () => {
    for (const text of CJK_CASES) {
      const { items } = await runDetect(text)
      const out = applyReplace(text, items)
      const open = (out.match(/<</g) || []).length
      const close = (out.match(/>>/g) || []).length
      expect(open, `文本: ${text}`).toBe(close)
    }
  })
})
