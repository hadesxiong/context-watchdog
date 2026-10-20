// 单元用例 - AI 有效性与逐站配置读取
import { describe, it, expect, afterEach, vi } from 'vitest'
import { isEffectiveAI, readBooleanMap } from '@engine/settings'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isEffectiveAI', () => {
  it('三层同时成立才生效', () => {
    expect(isEffectiveAI({ globalEnabled: true, siteEnabled: true, hostReady: true })).toBe(true)
  })

  it('任一层缺失都退回正则档', () => {
    expect(isEffectiveAI({ globalEnabled: false, siteEnabled: true, hostReady: true })).toBe(false)
    expect(isEffectiveAI({ globalEnabled: true, siteEnabled: false, hostReady: true })).toBe(false)
    expect(isEffectiveAI({ globalEnabled: true, siteEnabled: true, hostReady: false })).toBe(false)
  })

  it('全关时为 false', () => {
    expect(isEffectiveAI({ globalEnabled: false, siteEnabled: false, hostReady: false })).toBe(false)
  })
})

describe('readBooleanMap', () => {
  it('只保留值为 true 的键', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => ({
            'contextwatchdog.siteAiEnabled': {
              'https://a.example.com/*': true,
              'https://b.example.com/*': false,
              'https://c.example.com/*': 'yes'
            }
          })
        }
      }
    })

    expect(await readBooleanMap('contextwatchdog.siteAiEnabled')).toEqual({
      'https://a.example.com/*': true
    })
  })

  it('缺失 / 非对象 / 数组一律按空表处理', async () => {
    const responses: unknown[] = [undefined, null, 'x', ['https://a/*']]
    for (const value of responses) {
      vi.stubGlobal('chrome', {
        storage: { local: { get: async () => ({ key: value }) } }
      })
      expect(await readBooleanMap('key')).toEqual({})
    }
  })

  it('storage 抛错时不抛到调用方', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => {
            throw new Error('storage unavailable')
          }
        }
      }
    })

    expect(await readBooleanMap('key')).toEqual({})
  })
})
