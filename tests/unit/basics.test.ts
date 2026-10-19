// 单元用例 - 场景启发式 / 占位符 / PII 校验算法
import { describe, it, expect } from 'vitest'
import { detectScene } from '@engine/detector/sceneDetector'
import { generatePlaceholder, parsePlaceholder, isValidPlaceholder } from '@engine/replacer/placeholder'
import { isValidCNIdCard, isValidLuhn } from '@engine/detector/rules/piiRules'

describe('场景启发式', () => {
  it('env 场景', async () => {
    const r = await detectScene('API_KEY=abc\nDB_PASSWORD=def\nREDIS_URL=x')
    expect(r.type).toBe('env')
  })

  it('yaml 场景', async () => {
    const r = await detectScene('services:\n  web:\n    image: nginx\n    ports:\n      - 80')
    expect(r.type).toBe('yaml')
  })

  it('log 场景', async () => {
    const r = await detectScene('2026-10-16 12:00:01 INFO started\n2026-10-16 12:00:02 WARN slow')
    expect(r.type).toBe('log')
  })

  it('plain 场景', async () => {
    const r = await detectScene('你好，请帮我总结一下这段内容，谢谢！')
    expect(r.type).toBe('plain')
  })

  it('零延迟（启发式性能契约：< 10ms）', async () => {
    const big = 'KEY=value\n'.repeat(5000)
    const start = performance.now()
    await detectScene(big)
    expect(performance.now() - start).toBeLessThan(10)
  })
})

describe('语义化占位符', () => {
  it('生成：首条无序号，次条带序号', () => {
    expect(generatePlaceholder('PHONE', 1)).toBe('<<手机号>>')
    expect(generatePlaceholder('PHONE', 2)).toBe('<<手机号:2>>')
    expect(generatePlaceholder('ENV_PASSWORD', 1)).toBe('<<密码>>')
  })

  it('解析往返一致', () => {
    expect(parsePlaceholder('<<手机号>>')).toEqual({ type: 'PHONE', index: 1 })
    expect(parsePlaceholder('<<密码:3>>')).toEqual({ type: 'ENV_PASSWORD', index: 3 })
    expect(parsePlaceholder('<<IP地址>>')?.type).toBe('IP_ADDRESS')
  })

  it('兼容旧英文格式', () => {
    expect(parsePlaceholder('<<SECRET:1>>')?.type).toBe('HIGH_ENTROPY')
    expect(isValidPlaceholder('<<ENV_PASSWORD:2>>')).toBe(true)
  })

  it('拒绝非法格式', () => {
    expect(parsePlaceholder('不是占位符')).toBeNull()
    expect(parsePlaceholder('<<未知类型>>')).toBeNull()
  })
})

describe('PII 校验算法', () => {
  it('身份证 ISO 7064 校验位', () => {
    expect(isValidCNIdCard('11010519491231002X')).toBe(true)
    expect(isValidCNIdCard('110105194912310021')).toBe(false) // 校验位错
    expect(isValidCNIdCard('123456789012345678')).toBe(false)
    expect(isValidCNIdCard('1101051949123100X')).toBe(false)  // 长度错
  })

  it('银行卡 Luhn 校验', () => {
    expect(isValidLuhn('4532015112830366')).toBe(true)
    expect(isValidLuhn('4532015112830367')).toBe(false)
    expect(isValidLuhn('1234567812345670')).toBe(true) // Luhn 合法但非真实卡（算法层面通过）
    expect(isValidLuhn('12345')).toBe(false) // 长度不足
  })
})
