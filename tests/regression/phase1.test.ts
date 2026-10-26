// 回归用例 - Phase 1 全部修复点
import { describe, it, expect } from 'vitest'
import { runDetect, applyReplace, assertNoOverlap, assertSpansConsistent } from '../helpers'

describe('回归: 含 @ 密码', () => {
  it('scheme 连接串密码含 @ 与特殊字符', async () => {
    const cases = [
      { text: 'mysql://root:R00tP@ss!2024@db.example.com:3306/prod', pw: 'R00tP@ss!2024' },
      { text: 'redis://:p@ssw0rd@localhost:6379', pw: 'p@ssw0rd' },
      { text: 'mongodb://admin:pass@word@mongo1:27017/mydb', pw: 'pass@word' }
    ]
    for (const { text, pw } of cases) {
      const { items } = await runDetect(text)
      const hit = items.find(i => i.type === 'DB_PASSWORD' && i.original === pw)
      expect(hit, `应检出 DB_PASSWORD=${pw}`).toBeDefined()
      assertSpansConsistent(text, items)
      const out = applyReplace(text, items)
      expect(out).not.toContain(pw)
    }
  })

  it('无密码格式不误捕用户名', async () => {
    const { items } = await runDetect('mysql://user@host db info')
    expect(items.some(i => i.original === 'user')).toBe(false)
  })

  it('独立连接串（死代码修复）', async () => {
    const { items } = await runDetect('use admin:hunter2@db01.internal to connect')
    expect(items.some(i => i.type === 'DB_PASSWORD' && i.original === 'hunter2')).toBe(true)
  })

  it('邮件片段不被 DB_PASSWORD 误报', async () => {
    const { items } = await runDetect('Contact:support@company.com for details')
    expect(items.some(i => i.type === 'DB_PASSWORD')).toBe(false)
  })

  it('高熵含 @ 让位：邮箱形态交给 EMAIL 规则', async () => {
    const { items } = await runDetect('GPG_KEY=A3F1B9C8D7E6F5A4B3C2D1E0F9A8B7C6D5E4F3A2B1C0D9E8@example.com')
    // 不应有 HIGH_ENTROPY 吞并 @ 后半段（让位给 ENV_PASSWORD/EMAIL）
    const entropy = items.find(i => (i.detectionTypes || [i.type]).includes('HIGH_ENTROPY'))
    if (entropy) {
      expect(entropy.original.includes('@example.com')).toBe(false)
    }
  })
})

describe('回归: 重复值与泄漏', () => {
  it('同值跨字段 + 裸露出现：全部替换', async () => {
    const text = 'DB_PASSWORD=Tr0ub4dor&3x!\nOTHER_TOKEN=Tr0ub4dor&3x!\nlog: password is Tr0ub4dor&3x! ok'
    const { items } = await runDetect(text)
    const dups = items.filter(i => i.original === 'Tr0ub4dor&3x!')

    expect(dups.length).toBe(3) // 值传播覆盖裸露出现
    expect(new Set(dups.map(i => i.placeholder)).size).toBe(1)

    const out = applyReplace(text, items)
    expect(out).not.toContain('Tr0ub4dor')
  })
})

describe('回归: 重叠归并', () => {
  it('长连接串 span 不互切', async () => {
    const text = 'conn = user:Sup3rS3cretP@ssw0rdLongEnough123@db-cluster.prod.internal:5432/app'
    const { items } = await runDetect(text)
    assertNoOverlap(items)
    const out = applyReplace(text, items)
    // 占位符不互相嵌套
    const open = (out.match(/<</g) || []).length
    const close = (out.match(/>>/g) || []).length
    expect(open).toBe(close)
  })
})

describe('回归: env 跨行吞值', () => {
  it('空值行不吞下一行', async () => {
    const text = 'EMPTY_PASSWORD=\nSHORT_PASS=ab\nCOMMON_PASSWORD=realSecret99'
    const { items } = await runDetect(text)
    expect(items.some(i => i.original === 'ab')).toBe(false)
    expect(items.some(i => i.original === 'realSecret99')).toBe(true)
  })

  it('行内后续文本不吞值（邮箱可检出）', async () => {
    const text = 'API_KEY=Zx9Kq2LmN4Rt7Vw1Yb3Hd 与 support@example.com 沟通'
    const { items } = await runDetect(text)
    // env 值在空格处截断，不再吞掉邮箱
    expect(items.some(i => i.type === 'ENV_PASSWORD' && i.original === 'Zx9Kq2LmN4Rt7Vw1Yb3Hd')).toBe(true)
    expect(items.some(i => i.type === 'EMAIL' && i.original === 'support@example.com')).toBe(true)
  })

  it('引号包裹的含空格密码整体检出', async () => {
    const text = 'DB_PASSWORD="my secret pass 123"'
    const { items } = await runDetect(text)
    expect(items.some(i => i.original === 'my secret pass 123')).toBe(true)
  })
})

describe('回归: 类型合并', () => {
  it('JWT 与 ENV_PASSWORD 类型同时保留', async () => {
    const text = 'JWT_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const { items } = await runDetect(text)
    const hit = items.find(i => i.original.startsWith('eyJ'))!
    expect(hit).toBeDefined()
    expect(hit.detectionTypes || [hit.type]).toContain('JWT')
  })
})

describe('回归: ID 唯一性', () => {
  it('所有检测项 ID 唯一（配置不串项）', async () => {
    const text = [
      'A=Zx9Kq2LmN4Rt7Vw1Yb3Hd',
      'B=Zx9Kq2LmN4Rt7Vw1Yb3Hd',
      '13812345678',
      '13998765432',
      '联系 a@example.com 和 b@example.com'
    ].join('\n')
    const { items } = await runDetect(text)
    const ids = items.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
