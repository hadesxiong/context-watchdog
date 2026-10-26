// 用例 - 值白名单过滤（Phase 4 自定义档案）
import { describe, it, expect } from 'vitest'
import { runDetect, applyReplace, assertNoOverlap, assertSpansConsistent } from '../helpers'
import { detect } from '@engine/detector/pipeline'
import { getProfileById } from '@engine/detector/profiles'
import type { ProfileConfig } from '@engine/types'

const withWhitelist = (whitelist: string[]): ProfileConfig => ({
  ...structuredClone(getProfileById('universal')),
  id: 'user-test',
  name: '白名单测试',
  builtin: false,
  whitelist
})

describe('白名单过滤', () => {
  it('白名单值不检出（env 锚点命中也被过滤）', async () => {
    const profile = withWhitelist(['MyC0mpanyTestSecret'])
    const text = 'API_KEY=MyC0mpanyTestSecret\nREAL_SECRET=Zx9Kq2LmN4Rt7Vw1Yb3Hd'

    const { items } = await detect(text, profile)
    expect(items.some(i => i.original === 'MyC0mpanyTestSecret')).toBe(false)
    expect(items.some(i => i.original === 'Zx9Kq2LmN4Rt7Vw1Yb3Hd')).toBe(true)
  })

  it('白名单值的所有出现（含值传播）一并移除', async () => {
    const profile = withWhitelist(['Tr0ub4dor&3x!'])
    const text = [
      'DB_PASSWORD=Tr0ub4dor&3x!',
      '再说一次 Tr0ub4dor&3x!',
      '真实密钥',
      'REAL_SECRET=Zx9Kq2LmN4Rt7Vw1Yb3Hd'
    ].join('\n')

    const { items } = await detect(text, profile)
    expect(items.some(i => i.original === 'Tr0ub4dor&3x!')).toBe(false)
    expect(items.some(i => i.original === 'Zx9Kq2LmN4Rt7Vw1Yb3Hd')).toBe(true)
  })

  it('PII 白名单：指定手机号不检出，其他手机号仍检出', async () => {
    const profile = withWhitelist(['13812345678'])
    const text = '联系 13812345678 或 13998765432'

    const { items } = await detect(text, profile)
    expect(items.some(i => i.original === '13812345678')).toBe(false)
    expect(items.some(i => i.original === '13998765432')).toBe(true)
  })

  it('白名单精确匹配：子串/前缀不同的值不误放行', async () => {
    const profile = withWhitelist(['example.com'])
    const text = 'API_KEY=Zx9Kq2LmN4Rt7Vw1Yb3Hd 与 support@example.com 和 evil-example.com'

    const { items } = await detect(text, profile)
    // example.com 只精确匹配邮箱中的值？——邮箱 original 是 support@example.com，不等于白名单，仍检出
    expect(items.some(i => i.original === 'support@example.com')).toBe(true)
    expect(items.some(i => i.original === 'Zx9Kq2LmN4Rt7Vw1Yb3Hd')).toBe(true)
  })

  it('过滤后替换输出无残留且区间一致', async () => {
    const profile = withWhitelist(['13812345678'])
    const text = '白名单 13812345678 保留\nREAL_SECRET=Zx9Kq2LmN4Rt7Vw1Yb3Hd 替换'

    const { items } = await detect(text, profile)
    assertNoOverlap(items)
    assertSpansConsistent(text, items)

    const out = applyReplace(text, items)
    expect(out).toContain('13812345678')
    expect(out).not.toContain('Zx9Kq2LmN4Rt7Vw1Yb3Hd')
  })

  it('无白名单的档案行为不变（回归）', async () => {
    const { items } = await runDetect('DB_PASSWORD=Tr0ub4dor&3x!')
    expect(items.some(i => i.original === 'Tr0ub4dor&3x!')).toBe(true)
  })
})
