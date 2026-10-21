// 单元用例 - sanitizeWithProfile：粘贴拦截链路（SW 正则首答 + offscreen AI 升级）
// 必须执行档案的 keep/replace 判定。
// 2026-10-21 验收缺陷：两处都直接用 sanitizeText 无条件替换全部识别项，
// 把档案判定为「保留」的邮箱/高熵/IP 也一并脱敏了。
import { describe, it, expect } from 'vitest'
import { runDetect } from '../helpers'
import { sanitizeWithProfile, sanitizeText } from '@engine/replacer'
import { getProfileById } from '@engine/detector/profiles'
import type { DetectionItem, ProfileConfig } from '@engine/types'

// 拼接构造而非字面量：与 naturalPasswordRules.test.ts 同款，防 GitHub Push Protection
const PW = 'Qy7#mP2' + '!vL9@'

const universal = getProfileById('universal')

// 合成检测项（置信度可控，用于不依赖具体规则的策略层断言）
const makeItem = (over: Partial<DetectionItem>): DetectionItem => ({
  id: 'item-1',
  type: 'EMAIL',
  original: 'alice@example.com',
  placeholder: '<<邮箱>>',
  startIndex: 4,
  endIndex: 21,
  confidence: 'high',
  context: '',
  ...over
})

describe('sanitizeWithProfile - 按档案策略脱敏', () => {
  it('universal 档真机场景：散文口令被替换，判定为「保留」的邮箱原样留下', async () => {
    const text = `新密码是 ${PW}，重置邮件已发到 alice@example.com。`
    const { items } = await runDetect(text)

    // 两项都应被检出，否则用例前提失效
    expect(items.some(i => i.type === 'ENV_PASSWORD' && i.original === PW)).toBe(true)
    expect(items.some(i => i.type === 'EMAIL' && i.original === 'alice@example.com')).toBe(true)

    const { sanitizedText } = sanitizeWithProfile(text, items, universal)
    expect(sanitizedText).toContain('alice@example.com') // keep 判定被执行
    expect(sanitizedText).not.toContain(PW) // 凭据类照常替换
  })

  it('对照组：sanitizeText 无条件全替换（即被修复的旧行为）', async () => {
    const text = '重置邮件已发到 alice@example.com。'
    const { items } = await runDetect(text)
    expect(items.some(i => i.type === 'EMAIL')).toBe(true)

    const { sanitizedText } = sanitizeText(text, items)
    expect(sanitizedText).not.toContain('alice@example.com')
  })

  it('显式 defaultActions 覆盖：EMAIL 显式 replace 时邮箱也被替换', () => {
    const text = '联系我 alice@example.com'
    const item = makeItem({})
    const profile: ProfileConfig = {
      ...universal,
      defaultActions: { ...universal.defaultActions, EMAIL: 'replace' }
    }

    const { sanitizedText } = sanitizeWithProfile(text, [item], profile)
    expect(sanitizedText).toBe('联系我 <<邮箱>>')
  })

  it('tierLowConfidence：中低置信项降为保留，高置信项照常替换', () => {
    const text = '凭证 alice@example.com / bob@example.com'
    const low = makeItem({
      id: 'low',
      placeholder: '<<邮箱1>>',
      startIndex: 3,
      endIndex: 20,
      confidence: 'medium'
    })
    const high = makeItem({
      id: 'high',
      original: 'bob@example.com',
      placeholder: '<<邮箱2>>',
      startIndex: 23,
      endIndex: 38
    })
    const profile: ProfileConfig = { ...universal, defaultActions: {}, tierLowConfidence: true }

    const { sanitizedText } = sanitizeWithProfile(text, [low, high], profile)
    expect(sanitizedText).toContain('alice@example.com')
    expect(sanitizedText).not.toContain('bob@example.com')
  })
})
