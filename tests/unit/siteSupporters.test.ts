import { describe, expect, it } from 'vitest'
import {
  RECENT_LIMIT,
  thanksPlan,
  supporters,
  plan,
  type Supporter
} from '../../apps/site/src/data/supporters'

// 生成 N 位支持者（按时间升序：p1 最早，pN 最新）
const make = (n: number): Supporter[] =>
  Array.from({ length: n }, (_, index) => ({ name: `p${index + 1}` }))

describe('落地页感谢墙分档', () => {
  it('0 人：整个区块不渲染（空列表比没有更难堪）', () => {
    expect(thanksPlan([])).toEqual({ mode: 'hidden' })
  })

  it('1–3 人：spotlight，逐个露脸', () => {
    for (const n of [1, 2, 3]) {
      const result = thanksPlan(make(n))
      expect(result.mode).toBe('spotlight')
      if (result.mode !== 'spotlight') throw new Error('unreachable')
      expect(result.people).toHaveLength(n)
    }
  })

  it('4–20 人：单列列表', () => {
    for (const n of [4, 20]) {
      const result = thanksPlan(make(n))
      expect(result.mode).toBe('list')
      if (result.mode !== 'list') throw new Error('unreachable')
      expect(result.people).toHaveLength(n)
    }
  })

  it('21–100 人：网格 + 总数', () => {
    for (const n of [21, 100]) {
      const result = thanksPlan(make(n))
      expect(result.mode).toBe('grid')
      if (result.mode !== 'grid') throw new Error('unreachable')
      expect(result.people).toHaveLength(n)
      expect(result.total).toBe(n)
    }
  })

  it('超过 100 人：只显示最近 30 位，且最新的排在最前', () => {
    const result = thanksPlan(make(101))
    expect(result.mode).toBe('recent')
    if (result.mode !== 'recent') throw new Error('unreachable')
    expect(result.total).toBe(101)
    expect(result.shown).toHaveLength(RECENT_LIMIT)
    expect(result.shown[0]?.name).toBe('p101')
    expect(result.shown.at(-1)?.name).toBe('p72')
  })

  it('分档边界不重叠：20 与 21、100 与 101 落在不同档', () => {
    expect(thanksPlan(make(20)).mode).toBe('list')
    expect(thanksPlan(make(21)).mode).toBe('grid')
    expect(thanksPlan(make(100)).mode).toBe('grid')
    expect(thanksPlan(make(101)).mode).toBe('recent')
  })

  it('输入不被修改（列表按引用传进来，分档不该原地反转它）', () => {
    const people = make(105)
    const before = people.map((p) => p.name)
    thanksPlan(people)
    expect(people.map((p) => p.name)).toEqual(before)
  })

  it('当前仓库的 supporters.json 合法，且与分档函数一致', () => {
    expect(Array.isArray(supporters)).toBe(true)
    expect(plan).toEqual(thanksPlan(supporters))
    // 每个条目都必须有非空名字——姓名是展示主体，缺了就是脏数据
    for (const person of supporters) {
      expect(typeof person.name).toBe('string')
      expect(person.name.trim()).not.toBe('')
    }
  })
})
