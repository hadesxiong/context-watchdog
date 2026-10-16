// Golden 用例 - 不限（universal）Profile
// 语义：全规则并集 + 仲裁：凭据类直接替换，中低置信度仅提示（tierLowConfidence）
import { describe, it, expect } from 'vitest'
import { runDetect, applyReplace, assertNoOverlap, assertSpansConsistent } from '../helpers'

describe('universal profile - 混合输入仲裁', () => {
  it('PII + 密钥混排：两类同时检出，无区间重叠', async () => {
    const text = [
      '张工你好，我的手机号 13812345678，身份证 11010519491231002X',
      'deploy key: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456',
      '有问题联系 support@example.com',
      '数据库 mysql://root:R00tP@ss!2024@db.example.com:3306/prod'
    ].join('\n')

    const { items } = await runDetect(text)

    assertNoOverlap(items)
    assertSpansConsistent(text, items)

    // PII 检出
    expect(items.some(i => i.type === 'PHONE' && i.original === '13812345678')).toBe(true)
    expect(items.some(i => i.type === 'ID_CARD' && i.original === '11010519491231002X')).toBe(true)
    // 密钥检出
    expect(items.some(i => i.original.includes('sk-proj-'))).toBe(true)
    expect(items.some(i => i.type === 'DB_PASSWORD' && i.original === 'R00tP@ss!2024')).toBe(true)
    // 邮箱检出
    expect(items.some(i => i.type === 'EMAIL' && i.original === 'support@example.com')).toBe(true)

    // 脱敏后无凭据明文残留
    const out = applyReplace(text, items)
    expect(out).not.toContain('sk-proj-')
    expect(out).not.toContain('R00tP@ss!2024')
  })

  it('同值跨字段 + 裸露出现：全部替换且共享占位符', async () => {
    // 首次出现带锚点上下文（正则路径的检出依赖），后两次为裸露出现（值传播覆盖）
    // 说明：纯聊天中的"孤立"密码无任何上下文时由 GLiNER 级联负责（模型不在单测范围）
    const text = [
      'DB_PASSWORD=Tr0ub4dor&3x!',
      '强调一下：Tr0ub4dor&3x!',
      '最后重复一次 Tr0ub4dor&3x! 记得改'
    ].join('\n')

    const { items } = await runDetect(text)
    const dups = items.filter(i => i.original === 'Tr0ub4dor&3x!')

    expect(dups.length).toBe(3)
    expect(new Set(dups.map(i => i.placeholder)).size).toBe(1)

    const out = applyReplace(text, items)
    expect(out).not.toContain('Tr0ub4dor')
    // 3 处占位符都出现
    expect(out.split(dups[0].placeholder).length - 1).toBe(3)
  })
})

describe('universal profile - 默认策略依据', () => {
  it('邮箱检出（store 层将按 profile 配置默认 keep）', async () => {
    const { items } = await runDetect('联系 support@example.com 即可')
    const email = items.find(i => i.type === 'EMAIL')!
    expect(email).toBeDefined()
    // universal tierLowConfidence：非 high 置信度 → store 将默认 keep
    // EMAIL 显式配置为 keep（见 profiles.ts defaultActions）
  })

  it('中文混排下 span 与 original 严格一致（CJK 偏移回归）', async () => {
    const text = '中文测试：密码是 hunter2密码，手机号 13812345678 结束'
    const { items } = await runDetect(text)
    assertSpansConsistent(text, items)
    assertNoOverlap(items)
  })
})
