// 替换引擎单元测试 - apply 纯函数契约
import { describe, it, expect } from 'vitest'
import { Replacer } from '../../src/core/replacer'
import type { DetectionItem, ReplaceConfig } from '../../src/core/types'

const makeItem = (over: Partial<DetectionItem>): DetectionItem => ({
  id: 'id-1',
  type: 'ENV_PASSWORD',
  original: 'secretValue',
  placeholder: '<<密码>>',
  startIndex: 0,
  endIndex: 11,
  confidence: 'high',
  context: '',
  ...over
})

describe('Replacer.apply', () => {
  it('同值多处共享占位符，全部替换', () => {
    const text = 'a=secretValue b=secretValue c=secretValue'
    const items = [
      makeItem({ id: '1', original: 'secretValue', placeholder: '<<密码>>', startIndex: 2, endIndex: 13 }),
      makeItem({ id: '2', original: 'secretValue', placeholder: '<<密码>>', startIndex: 16, endIndex: 27 }),
      makeItem({ id: '3', original: 'secretValue', placeholder: '<<密码>>', startIndex: 30, endIndex: 41 })
    ]
    const configs: ReplaceConfig[] = items.map(i => ({ itemId: i.id, action: 'replace' }))

    const { sanitizedText, mappingTable } = new Replacer().apply(text, items, configs)

    expect(sanitizedText).not.toContain('secretValue')
    expect(sanitizedText.split('<<密码>>').length - 1).toBe(3)
    // 映射表同值只有一条
    expect(Object.keys(mappingTable)).toHaveLength(1)
  })

  it('keep 的项不替换，其余正常替换', () => {
    const text = 'keep1 secretValue keep2 otherValue99'
    const items = [
      makeItem({ id: '1', original: 'secretValue', placeholder: '<<密码>>', startIndex: 6, endIndex: 17 }),
      makeItem({ id: '2', type: 'API_KEY', original: 'otherValue99', placeholder: '<<API密钥>>', startIndex: 25, endIndex: 37 })
    ]
    const configs: ReplaceConfig[] = [
      { itemId: '1', action: 'keep' },
      { itemId: '2', action: 'replace' }
    ]

    const { sanitizedText } = new Replacer().apply(text, items, configs)
    expect(sanitizedText).toContain('secretValue')
    expect(sanitizedText).not.toContain('otherValue99')
  })

  it('apply 是纯函数：不修改单例状态（重复调用结果稳定）', () => {
    const text = 'x=secretValue'
    const items = [makeItem({ id: '1', startIndex: 2, endIndex: 13 })]
    const configs: ReplaceConfig[] = [{ itemId: '1', action: 'replace' }]
    const replacer = new Replacer()

    const r1 = replacer.apply(text, items, configs)
    const r2 = replacer.apply(text, items, configs)
    expect(r1.sanitizedText).toBe(r2.sanitizedText)
    expect(r1.mappingTable).toEqual(r2.mappingTable)
  })

  it('customPlaceholder 生效且同值共享', () => {
    const text = 'a=secretValue b=secretValue'
    const items = [
      makeItem({ id: '1', startIndex: 2, endIndex: 13 }),
      makeItem({ id: '2', startIndex: 16, endIndex: 27 })
    ]
    const configs: ReplaceConfig[] = [
      { itemId: '1', action: 'replace', customPlaceholder: '<<客户密码>>' },
      { itemId: '2', action: 'replace' }
    ]

    const { sanitizedText } = new Replacer().apply(text, items, configs)
    expect(sanitizedText.split('<<客户密码>>').length - 1).toBe(2)
  })
})
