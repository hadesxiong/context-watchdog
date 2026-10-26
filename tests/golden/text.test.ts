// Golden 用例 - 通用文本（text）Profile：PII 为主、高熵 strict（30 字符/熵 4.0）、tierLowConfidence
import { describe, it, expect } from 'vitest'
import { runDetect, applyReplace, assertNoOverlap, assertSpansConsistent } from '../helpers'

describe('text profile - 通用文本', () => {
  it('工单/聊天文本：PII 全量检出', async () => {
    const text = [
      '客户反馈：',
      '姓名：王小明',
      '联系电话 13812345678（备用 010-87654321）',
      '身份证 11010519491231002X',
      '银行卡 4532015112830366 冷结',
      '地址：北京市海淀区中关村大街1号',
      '如有疑问回复本工单或邮件 wangxm@example.com'
    ].join('\n')

    const { items } = await runDetect(text, 'text')

    assertNoOverlap(items)
    assertSpansConsistent(text, items)

    expect(items.some(i => i.type === 'PHONE' && i.original === '13812345678')).toBe(true)
    expect(items.some(i => i.type === 'PHONE' && i.original === '010-87654321')).toBe(true)
    expect(items.some(i => i.type === 'ID_CARD')).toBe(true)
    expect(items.some(i => i.type === 'BANK_CARD')).toBe(true)
    expect(items.some(i => i.type === 'EMAIL')).toBe(true)

    const out = applyReplace(text, items)
    expect(out).not.toContain('13812345678')
    expect(out).not.toContain('11010519491231002X')
    expect(out).not.toContain('4532015112830366')
    // 邮箱默认保留（applyReplace 不带 keepIds 会替换，此处只验证检出；默认策略在 store 层）
  })

  it('高熵 strict：散文中的长句不误报', async () => {
    // 28 字符混合串：strict 阈值 30，不应检出
    const text = '这是一段普通的散文内容 XK9pQmZr7Tb4Wn8Yc3Hd5Jf 用于测试'
    const { items } = await runDetect(text, 'text')
    expect(items.some(i => (i.detectionTypes || [i.type]).includes('HIGH_ENTROPY'))).toBe(false)
  })

  it('弱口令家族不误报', async () => {
    const text = 'COMMON_PASSWORD=password123\nWEAK_PASS=admin888\nDEFAULT_SECRET=secret'
    const { items } = await runDetect(text, 'text')
    expect(items.filter(i => i.type === 'ENV_PASSWORD')).toHaveLength(0)
  })

  it('车牌与 IP 检出', async () => {
    const { items } = await runDetect('车辆 京A12345 停在 10.0.0.8 附近', 'text')
    expect(items.some(i => i.type === 'PLATE' && i.original === '京A12345')).toBe(true)
    expect(items.some(i => i.type === 'IP_ADDRESS' && i.original === '10.0.0.8')).toBe(true)
  })
})
