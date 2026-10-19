// 单元用例 - 自定义正则规则（Phase 5）：ReDoS 防护 / 扫描 / 管线集成
import { describe, it, expect } from 'vitest'
import {
  validateCustomPattern,
  validateCustomRule,
  scanCustomRules,
  compileCustomRule,
  CUSTOM_PATTERN_MAX_LENGTH
} from '@engine/detector/rules/customRules'
import { detect } from '@engine/detector/pipeline'
import { getProfileById } from '@engine/detector/profiles'
import type { ProfileConfig, CustomRule } from '@engine/types'

const makeRule = (over: Partial<CustomRule>): CustomRule => ({
  id: `rule-${Math.random()}`,
  name: '测试规则',
  pattern: 'EMP-\\d{6}',
  type: 'ID_CARD',
  confidence: 'high',
  enabled: true,
  ...over
})

describe('ReDoS 静态防护', () => {
  it('拒绝嵌套量词', () => {
    expect(validateCustomPattern('(a+)+').ok).toBe(false)
    expect(validateCustomPattern('(a*)*').ok).toBe(false)
    expect(validateCustomPattern('(a?)+b').ok).toBe(false)
    expect(validateCustomPattern('([a-z]+)+x').ok).toBe(false)
    expect(validateCustomPattern('(\\d+)*').ok).toBe(false)
    // 嵌套两层也拒绝
    expect(validateCustomPattern('((ab)+)*').ok).toBe(false)
  })

  it('接受常见安全模式', () => {
    expect(validateCustomPattern('EMP-\\d{6}').ok).toBe(true)
    expect(validateCustomPattern('(VIP|SVIP)-[A-Z]{4}').ok).toBe(true)   // 量词化的交替组安全
    expect(validateCustomPattern('USR_[a-f0-9]{32}').ok).toBe(true)
    expect(validateCustomPattern('订单号[0-9]{10,15}').ok).toBe(true)
    expect(validateCustomPattern('(?:secret|token)-\\w+').ok).toBe(true) // 非捕获组量词
    expect(validateCustomPattern('[A-Z]{2}\\d{4}').ok).toBe(true)         // 字符类量词不算嵌套
  })

  it('拒绝语法错误 / 超长 / 空', () => {
    expect(validateCustomPattern('(unclosed').ok).toBe(false)
    expect(validateCustomPattern('[z-a]').ok).toBe(false)
    expect(validateCustomPattern('').ok).toBe(false)
    expect(validateCustomPattern('a'.repeat(CUSTOM_PATTERN_MAX_LENGTH + 1)).ok).toBe(false)
  })

  it('规则级校验：名称/重复', () => {
    const existing = [makeRule({ pattern: 'X-1' })]
    expect(validateCustomRule({ name: '', pattern: 'Y-1', type: 'PHONE' }, existing).ok).toBe(false)
    expect(validateCustomRule({ name: 'r', pattern: 'X-1', type: 'PHONE' }, existing).ok).toBe(false)
    expect(validateCustomRule({ name: 'r', pattern: 'Y-1', type: 'PHONE' }, existing).ok).toBe(true)
  })

  it('compileCustomRule 拒绝危险模式返回 null', () => {
    expect(compileCustomRule(makeRule({ pattern: '(a+)+' }))).toBeNull()
    expect(compileCustomRule(makeRule({ pattern: 'EMP-\\d{6}' }))).not.toBeNull()
  })
})

describe('scanCustomRules', () => {
  it('命中并正确定位', () => {
    const text = '员工 EMP-123456 和 EMP-999999，其他内容'
    const { items, warnings } = scanCustomRules(text, [makeRule({})])

    expect(warnings).toHaveLength(0)
    expect(items).toHaveLength(2)
    expect(items[0].original).toBe('EMP-123456')
    expect(text.substring(items[0].startIndex, items[0].endIndex)).toBe('EMP-123456')
    expect(text.substring(items[1].startIndex, items[1].endIndex)).toBe('EMP-999999')
  })

  it('停用规则不执行', () => {
    const { items } = scanCustomRules('EMP-123456', [makeRule({ enabled: false })])
    expect(items).toHaveLength(0)
  })

  it('匹配上限保护（死循环防线）', () => {
    // 零宽匹配模式：不应死循环，不应产出
    const { items } = scanCustomRules('aaaa', [makeRule({ pattern: 'a*', type: 'HIGH_ENTROPY' })])
    expect(items.length).toBeLessThanOrEqual(200)
  })

  it('匹配数超上限中断并警告', () => {
    const text = 'ab '.repeat(300) // 300 处匹配 > 上限 200
    const { items, warnings } = scanCustomRules(text, [makeRule({ pattern: 'ab', type: 'HIGH_ENTROPY' })])
    expect(items.length).toBe(200)
    expect(warnings.some(w => w.includes('上限'))).toBe(true)
  })

  it('危险模式给出警告而非崩溃', () => {
    const { items, warnings } = scanCustomRules('anything', [makeRule({ pattern: '(a+)+' })])
    expect(items).toHaveLength(0)
    expect(warnings.some(w => w.includes('校验失败'))).toBe(true)
  })
})

describe('管线集成', () => {
  const profileWithRule = (rules: CustomRule[]): ProfileConfig => ({
    ...structuredClone(getProfileById('universal')),
    id: 'user-custom-test',
    name: '自定义规则测试',
    builtin: false,
    customRules: rules
  })

  it('自定义规则命中进入检出列表，走完整管线', async () => {
    const profile = profileWithRule([makeRule({})])
    const text = '工号 EMP-123456 已登记'

    const { items } = await detect(text, profile)
    const hit = items.find(i => i.original === 'EMP-123456')
    expect(hit).toBeDefined()
    expect(hit!.type).toBe('ID_CARD')
    expect(hit!.source).toBe('regex')
  })

  it('自定义规则值也参与同值共享与值传播', async () => {
    const profile = profileWithRule([makeRule({ pattern: 'ORD\\d{8}', type: 'API_KEY' })])
    const text = 'ORD12345678\n备注 ORD12345678 重复'

    const { items } = await detect(text, profile)
    const hits = items.filter(i => i.original === 'ORD12345678')
    expect(hits.length).toBe(2)
    expect(new Set(hits.map(i => i.placeholder)).size).toBe(1)
  })

  it('自定义规则结果受白名单约束', async () => {
    const profile = { ...profileWithRule([makeRule({})]), whitelist: ['EMP-123456'] }
    const { items } = await detect('工号 EMP-123456', profile)
    expect(items.some(i => i.original === 'EMP-123456')).toBe(false)
  })

  it('无自定义规则的档案行为不变（回归）', async () => {
    const { items } = await detect('DB_PASSWORD=Tr0ub4dor&3x!', getProfileById('universal'))
    expect(items.some(i => i.original === 'Tr0ub4dor&3x!')).toBe(true)
  })
})
