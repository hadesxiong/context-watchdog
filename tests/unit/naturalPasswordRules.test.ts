// 单元用例 - 自然语言口令规则（散文/工单形态的检出与三层精度防线）
import { describe, it, expect } from 'vitest'
import { runDetect, applyReplace, assertNoOverlap, assertSpansConsistent } from '../helpers'
import { naturalPasswordRules } from '@engine/detector/rules/naturalPasswordRules'

// 拼接构造而非字面量：与 apiKeyRules.test.ts 同款，防 GitHub Push Protection 拦截推送
const PW = 'Qy7#mP2' + '!vL9@'

// 模式层结果（不含 extractor 的值质量判断，用于区分「不匹配」与「匹配后被丢弃」）
const matchRule = (text: string): string[] =>
  Array.from(text.matchAll(naturalPasswordRules[0].pattern)).map(m => m[0])

describe('自然语言口令 - 检出', () => {
  it('中文「新密码是」散文（2026-10-21 真机漏检原文），与 PII 共存无重叠', async () => {
    const text = `我的手机号 13812345678，我按页面提示自助重置了密码，新密码是 ${PW}，但重置后还是进不去。`
    const { items } = await runDetect(text)

    const hit = items.find(i => i.type === 'ENV_PASSWORD' && i.original === PW)
    expect(hit, '应检出口令').toBeDefined()
    assertSpansConsistent(text, items)
    assertNoOverlap(items)

    const out = applyReplace(text, items)
    expect(out).not.toContain(PW)
    expect(out).not.toContain('13812345678')
  })

  it('全角冒号且值后紧跟中文（值域在 CJK 处截断）', async () => {
    const text = `登录口令：${PW}请查收`
    const { items } = await runDetect(text)
    const hit = items.find(i => i.original === PW)
    expect(hit).toBeDefined()
    expect(text.substring(hit!.startIndex, hit!.endIndex)).toBe(PW)
  })

  it('英文 password is 形态，句末句号不进 span', async () => {
    const text = `The new password is ${PW}. Please rotate it.`
    const { items } = await runDetect(text)
    const hit = items.find(i => i.original === PW)
    expect(hit).toBeDefined()
    expect(text.substring(hit!.startIndex, hit!.endIndex)).toBe(PW)
    assertSpansConsistent(text, items)
  })

  it('口令为 + 无空格直连', async () => {
    const { items } = await runDetect(`临时口令为${PW}`)
    expect(items.some(i => i.original === PW)).toBe(true)
  })
})

describe('自然语言口令 - 精度防线', () => {
  it('中文谓词落不进值域（模式层即不匹配）', () => {
    expect(matchRule('密码不能为空')).toEqual([])
    expect(matchRule('密码是相同的处理方式')).toEqual([])
    expect(matchRule('密码要求至少 8 位')).toEqual([])
    // 用户工单备注原句：密码后无连接词
    expect(matchRule('工单里涉及的密码和 API Key 仅用于测试识别')).toEqual([])
  })

  it('英文缺连接词/纯字母表语不检出', async () => {
    // 无连接词：模式层不匹配
    expect(matchRule('the password management system')).toEqual([])
    // 有连接词但表语为纯字母：extractor 层挡掉
    expect(matchRule('The password is required.')).toHaveLength(1)
    const { items } = await runDetect('The password is required. If it is invalid, reset it.')
    expect(items.some(i => i.type === 'ENV_PASSWORD')).toBe(false)
  })

  it('纯数字与弱口令跳过', async () => {
    const { items } = await runDetect('新密码是 123456，旧密码是 password')
    expect(items.filter(i => i.type === 'ENV_PASSWORD')).toHaveLength(0)
  })
})
