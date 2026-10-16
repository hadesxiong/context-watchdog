// 性能基准 - 长文本检测 < 2s（正则路径毫秒级；模型路径不在本测试范围）
import { describe, it, expect } from 'vitest'
import { runDetect } from '../helpers'

// 生成约 5000 字的混合长文档
const buildLongDoc = (): string => {
  const paragraphs = [
    '这是一段普通的会议纪要内容，讨论了下个季度的产品规划和人员安排。',
    'DB_PASSWORD=Zx9Kq2LmN4Rt7Vw1Yb3Hd 配置已在上周更新，注意同步。',
    '客户张三的联系方式 13812345678，身份证 11010519491231002X。',
    '服务器连接串 mysql://deploy:S3cretP@ss@10.0.0.8:3306/maindb 已轮换。',
    'API 文档地址 https://example.com/docs/api 参考即可。',
    '银行卡 4532015112830366 的对账单已发送财务。'
  ]
  let doc = ''
  while (doc.length < 5000) {
    doc += paragraphs.join('\n') + '\n\n'
  }
  return doc
}

describe('性能基准', () => {
  it('5000 字混合文档检测 < 2000ms（universal profile）', async () => {
    const doc = buildLongDoc()
    const start = performance.now()
    const { items } = await runDetect(doc)
    const elapsed = performance.now() - start

    console.log(`[perf] universal: ${doc.length} chars, ${items.length} items, ${elapsed.toFixed(0)}ms`)
    expect(elapsed).toBeLessThan(2000)
    // 基本召回保障：长文档中的特征项应检出
    expect(items.some(i => i.original === '13812345678')).toBe(true)
    expect(items.some(i => i.original === '11010519491231002X')).toBe(true)
  })

  it('5000 字混合文档检测 < 2000ms（text profile）', async () => {
    const doc = buildLongDoc()
    const start = performance.now()
    const { items } = await runDetect(doc, 'text')
    const elapsed = performance.now() - start

    console.log(`[perf] text: ${doc.length} chars, ${items.length} items, ${elapsed.toFixed(0)}ms`)
    expect(elapsed).toBeLessThan(2000)
  })

  it('5000 字混合文档检测 < 2000ms（code profile）', async () => {
    const doc = buildLongDoc()
    const start = performance.now()
    const { items } = await runDetect(doc, 'code')
    const elapsed = performance.now() - start

    console.log(`[perf] code: ${doc.length} chars, ${items.length} items, ${elapsed.toFixed(0)}ms`)
    expect(elapsed).toBeLessThan(2000)
  })
})
