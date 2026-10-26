// Golden 用例 - 代码开发（code）Profile：密钥全开、高熵 loose（20 字符/熵 3.0）、PII 默认 keep（store 层）、不做置信度分层
import { describe, it, expect } from 'vitest'
import { runDetect, applyReplace, assertNoOverlap, assertSpansConsistent } from '../helpers'

describe('code profile - 开发场景', () => {
  it('docker-compose 类配置：YAML 密钥全检出', async () => {
    const text = [
      'services:',
      '  app:',
      '    environment:',
      '      DB_PASSWORD: R00tP@ss!2024',
      '      REDIS_URL: redis://:cachePass@redis:6379',
      '      API_KEY: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456',
      '      APP_PORT: 8080'
    ].join('\n')

    const { items } = await runDetect(text, 'code')

    assertNoOverlap(items)
    assertSpansConsistent(text, items)

    expect(items.some(i => i.original === 'R00tP@ss!2024')).toBe(true)
    expect(items.some(i => i.original === 'cachePass')).toBe(true)
    expect(items.some(i => i.original.includes('sk-proj-'))).toBe(true)
    expect(items.some(i => i.original === '8080')).toBe(false)

    const out = applyReplace(text, items)
    expect(out).not.toContain('R00tP@ss!2024')
    expect(out).not.toContain('cachePass')
    expect(out).toContain('DB_PASSWORD: <<')
    expect(out).toContain('APP_PORT: 8080')
  })

  it('env 文件：空值/短值/弱密码过滤', async () => {
    const text = [
      'EMPTY_PASSWORD=',
      'SHORT_PASS=ab',
      'COMMON_PASSWORD=password123',
      'REAL_SECRET=Zx9Kq2LmN4Rt7Vw1Yb3'
    ].join('\n')

    const { items } = await runDetect(text, 'code')

    expect(items.some(i => i.original === '')).toBe(false)
    expect(items.some(i => i.original === 'ab')).toBe(false)
    expect(items.some(i => i.original === 'password123')).toBe(false)
    expect(items.some(i => i.original === 'Zx9Kq2LmN4Rt7Vw1Yb3')).toBe(true)
  })

  it('JSON 配置：api_key 检出、timeout 不检出', async () => {
    const text = '{\n  "api_key": "sk-proj-Zx9Kq2LmN4Rt7Vw1Yb3Hd5Jf8Gc6Sa",\n  "timeout": 30\n}'
    const { items } = await runDetect(text, 'code')

    expect(items.some(i => i.original.includes('sk-proj-'))).toBe(true)
    expect(items.some(i => i.original === '30')).toBe(false)
  })

  it('高熵 loose：22 字符串检出', async () => {
    const text = 'token value is Xk9pQm2Zr7Tb4Wn8Yc3Hd5Jf here'
    const { items } = await runDetect(text, 'code')
    expect(items.some(i => (i.detectionTypes || [i.type]).includes('HIGH_ENTROPY'))).toBe(true)
  })

  it('注释中的假密码（GLiNER 场景，正则路径下允许误报，记录现状）', async () => {
    // 现状：KEY= 在注释行仍会被 env 规则命中（^ 锚定行首），Phase 2+ 交给模型级联修正；
    // 此处锁定当前行为防止意外变化
    const text = '# PASSWORD=test1234 示例（注意：test1234 含数字后缀会被弱口令过滤）'
    const { items } = await runDetect(text, 'code')
    // test1234 → 剥后缀 test → 弱口令 → 不检出
    expect(items.some(i => i.original === 'test1234')).toBe(false)
  })
})
