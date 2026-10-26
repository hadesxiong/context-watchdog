// 单元用例 - API 密钥规则（重点覆盖短密钥族的命中与误报防线）
import { describe, it, expect } from 'vitest'
import { apiKeyRules } from '@engine/detector/rules/apiKeyRules'

// 全部用拼接构造而非字面量：真实格式的密钥字面量会被 GitHub Push Protection
// 逐条拦截推送（2026-10-18 实测教训），构造串免疫且测试强度不减
const matchAll = (text: string): string[] =>
  apiKeyRules.flatMap(rule => Array.from(text.matchAll(rule.pattern)).map(m => m[0]))

describe('短密钥族规则（前缀即证据策略）', () => {
  const positives: Array<[string, string]> = [
    ['Anthropic Claude', 'sk-ant-api03-' + 'a1B2'.repeat(8)],
    ['Hugging Face', 'hf_' + 'Ab3x'.repeat(9)],
    ['npm', 'npm_' + 'A1'.repeat(18)],
    ['GitLab', 'glpat-' + 'x9Y_-'.repeat(4)],
    ['SendGrid', 'SG.' + 'aB3-'.repeat(5) + '.' + 'zX8_'.repeat(5)],
    ['Postman', 'PMAK-' + 'a1B2'.repeat(6) + '-' + 'c3D4'.repeat(6)],
    ['Shopify', 'shpat_' + 'ab12'.repeat(8)],
    ['DigitalOcean', 'dop_v1_' + '0f'.repeat(32)],
    ['Mailgun', 'key-' + 'dead'.repeat(8)],
    ['Twilio', 'SK' + 'A1b2'.repeat(8)]
  ]

  it.each(positives)('%s 官方短格式被精确命中', (_name, value) => {
    expect(matchAll(`token: ${value} end`)).toContain(value)
  })
})

describe('短密钥族误报防线', () => {
  it('长度不足官方规格不命中', () => {
    expect(matchAll('npm_' + 'A1'.repeat(17))).toEqual([]) // npm 需恰好 36
    expect(matchAll('hf_' + 'Ab3x'.repeat(6))).toEqual([]) // HF 需 ≥30
    expect(matchAll('shpat_' + 'ab12'.repeat(7))).toEqual([]) // Shopify 需恰好 32 hex
    expect(matchAll('key-deadbeef')).toEqual([]) // Mailgun 需恰好 32 hex
  })

  it('字符集不符不命中（十六进制族与普通词区分）', () => {
    expect(matchAll('shpat_' + 'ghij'.repeat(8))).toEqual([]) // g/h/i/j 非 hex
    expect(matchAll('SK' + 'z1Aa'.repeat(8))).toEqual([]) // z 非 hex
  })

  it('前缀残缺/无边界不命中', () => {
    expect(matchAll('sk-an-' + 'a1B2'.repeat(8))).toEqual([]) // 非 sk-ant-，且 OpenAI 规则同样不满足
    expect(matchAll('SG' + 'abcdef1234567890')).toEqual([]) // 缺点分隔结构
    expect(matchAll('PMAK-只是一个前缀 demo')).toEqual([]) // 后续非 alnum
  })

  it('普通文本共存不误报', () => {
    expect(matchAll('U.S.G.a 公司会议纪要，key-value 配对使用')).toEqual([])
    expect(matchAll('hf_ 前缀的普通文件名和 SK 状态缩写')).toEqual([])
  })
})

describe('sk- 厂商段规则（sk-<vendor>-<hex> 形态）', () => {
  const key = 'sk-live-' + '7f3a9c2e'.repeat(4) // 32 位小写十六进制体

  it('sk- + 小写厂商段 + 32 位十六进制体被命中', () => {
    expect(matchAll(`值是 ${key}。`)).toContain(key)
  })

  it('体非纯小写十六进制不命中（sk-an- 混合大小写防线共存）', () => {
    expect(matchAll('sk-live-' + 'A1b2'.repeat(8))).toEqual([])
  })

  it('体不足 32 位不命中', () => {
    expect(matchAll('sk-live-' + 'ab12'.repeat(4))).toEqual([]) // 16 < 32
  })

  it('厂商段后的体带连字符不命中（体必须连续十六进制）', () => {
    expect(matchAll('sk-live-ab12cd34-' + '0f'.repeat(16))).toEqual([])
  })
})

describe('既有规则回归（与短密钥族共存）', () => {
  it('OpenAI sk- 规则不受 sk-ant- 分支影响', () => {
    const openai = 'sk-' + 'a1B2'.repeat(5)
    expect(matchAll(`key=${openai}`)).toContain(openai)
  })

  it('Anthropic sk-ant- 不会被 OpenAI 规则截半误匹配', () => {
    const anthropic = 'sk-ant-api03-' + 'a1B2'.repeat(8)
    const hits = matchAll(anthropic)
    expect(hits).toContain(anthropic)
    expect(hits.every(h => h === anthropic)).toBe(true)
  })
})
