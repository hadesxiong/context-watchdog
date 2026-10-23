// 单元用例 - AI 档语言守卫（中文占优片段跳过 GLiNER）
// 背景：gliner_small-v2 为纯英文词表，中文塌缩 [UNK] → 喂中文只产出幻觉
//       （取证见 spec §13-3）；固定形状实体由正则全覆盖，跳过无检测损失。
// 判定口径：CJK 字母数 ≥ 拉丁字母数 → 跳过（数字/符号不参与计数）
import { describe, it, expect } from 'vitest'
import { isCjkDominant } from '../../packages/extension/src/model/languageGuard'

describe('isCjkDominant', () => {
  it('纯中文长句 → 跳过（样例 D 的地址段，模型对它全盲）', () => {
    expect(
      isCjkDominant('用户李雷的收货地址是上海市浦东新区世纪大道 100 号，工作日白天有人签收。')
    ).toBe(true)
  })

  it('纯英文 → 不跳过（small-v2 的主场）', () => {
    expect(isCjkDominant('Please send the invoice to John Smith at 123 Main Street.')).toBe(false)
  })

  it('混合偏拉丁（CJK 5 vs 拉丁 9）→ 不跳过，保住拉丁实体的 AI 检出', () => {
    expect(isCjkDominant('请帮我联系 John Smith')).toBe(false)
  })

  it('混合偏中文（CJK 20 vs 拉丁 8）→ 跳过', () => {
    expect(isCjkDominant('请把发票发给 Zhang Wei，谢谢配合，甲方要求今天完成对账')).toBe(true)
  })

  it('中文 + 纯数字（数字不参与计数）→ 跳过，号码本身由正则档负责', () => {
    expect(isCjkDominant('订单1234567890')).toBe(true)
  })

  it('空串 / 纯数字 / 纯符号 → 不跳过（无中文，非本守卫管辖）', () => {
    expect(isCjkDominant('')).toBe(false)
    expect(isCjkDominant('13800138000')).toBe(false)
    expect(isCjkDominant('--- ===')).toBe(false)
  })

  it('单个汉字 → 跳过（有中文即存在幻觉面，拉丁 0）', () => {
    expect(isCjkDominant('户')).toBe(true)
  })

  it('私用区字符不算汉字（历史字面量区间越界回归：U+E000 须判非中文）', () => {
    expect(isCjkDominant('\uE000\uE001 test')).toBe(false)
    expect(isCjkDominant('\uE000')).toBe(false)
    // U+F900（豈）属兼容区汉字，按设计算汉字
    expect(isCjkDominant('\uF900')).toBe(true)
  })
})
