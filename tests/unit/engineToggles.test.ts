// 单元用例 - 引擎开关（正则 / 场景识别）
// 覆盖：normalizeEngineToggles 脏数据容错 / pipeline 的 enableRegexFallback 与
//       enableSceneDetection 接线（关闭后对应引擎确实不产出）
import { describe, it, expect } from 'vitest'
import { normalizeEngineToggles, DEFAULT_ENGINE_TOGGLES } from '../../src/core/detector/engineToggles'
import { detect } from '../../src/core/detector/pipeline'
import { getProfileById } from '../../src/core/detector/profiles'

describe('normalizeEngineToggles', () => {
  it('合法值原样保留', () => {
    expect(normalizeEngineToggles({ regex: false, scene: true })).toEqual({ regex: false, scene: true })
  })

  it('null / 非对象 / 脏字段 → 回落默认（全开），不抛错', () => {
    expect(normalizeEngineToggles(null)).toEqual(DEFAULT_ENGINE_TOGGLES)
    expect(normalizeEngineToggles(undefined)).toEqual(DEFAULT_ENGINE_TOGGLES)
    expect(normalizeEngineToggles('yes')).toEqual(DEFAULT_ENGINE_TOGGLES)
    expect(normalizeEngineToggles(42)).toEqual(DEFAULT_ENGINE_TOGGLES)
    // 字段类型错误只回落该字段
    expect(normalizeEngineToggles({ regex: 'no', scene: false })).toEqual({ regex: true, scene: false })
    expect(normalizeEngineToggles({})).toEqual(DEFAULT_ENGINE_TOGGLES)
  })
})

describe('pipeline 引擎开关接线', () => {
  const profile = getProfileById('universal')
  // 密码赋值规则带行首锚点 → 用多行文本（与 golden 用例同款写法）
  const text = ['我的手机号 13812345678', 'DB_PASSWORD=Tr0ub4dor&3x!'].join('\n')

  it('默认（开关全开）：正则检出手机号与密码', async () => {
    const { items } = await detect(text, profile)
    expect(items.some(i => i.type === 'PHONE')).toBe(true)
    expect(items.some(i => i.type === 'ENV_PASSWORD' || i.type === 'DB_PASSWORD')).toBe(true)
  })

  it('enableRegexFallback=false：正则引擎整体停用（含自定义规则）→ 无检出', async () => {
    // 单测环境无 GLiNER 模型（isContentModelReady=false），只剩正则档 → 关掉即为空
    const { items } = await detect(text, profile, { enableRegexFallback: false })
    expect(items).toHaveLength(0)
  })

  it('enableSceneDetection=false：不影响正则检出（场景仅作启发式提示）', async () => {
    const { items } = await detect(text, profile, { enableSceneDetection: false })
    expect(items.some(i => i.original === '13812345678')).toBe(true)
  })
})
