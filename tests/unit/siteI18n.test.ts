import { describe, expect, it } from 'vitest'
import zh from '../../apps/site/src/i18n/zh.json'
import en from '../../apps/site/src/i18n/en.json'
import { format, splitBold, localePath, otherLocale, siteBase } from '../../apps/site/src/i18n'

// 落地页双语词典的防漂移护栏。
//
// 落地页是**构建期**定语言的静态站点，没有运行时回退（不像扩展的 t() 还能回退到
// 另一门语言）。也就是说：某一门语言漏了一条，页面上就是一段空白，且构建不会报错。
// 因此这里必须在构建期就把这类问题挡下来。

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** 收集所有叶子节点的路径 → 值 */
const leaves = (value: Json, prefix = ''): Map<string, string> => {
  const out = new Map<string, string>()
  if (typeof value === 'string') {
    out.set(prefix, value)
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [key, text] of leaves(item, `${prefix}[${index}]`)) out.set(key, text)
    })
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      for (const [path, text] of leaves(child, prefix ? `${prefix}.${key}` : key)) out.set(path, text)
    }
  }
  return out
}

const zhLeaves = leaves(zh as unknown as Json)
const enLeaves = leaves(en as unknown as Json)

const HAN = /[\u4e00-\u9fff]/

/** 抽出 {name} 占位符名（插值用） */
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]!).sort()

describe('落地页词典：结构完整性', () => {
  it('两门语言的键集合完全一致（多一条少一条都算漂移）', () => {
    const zhKeys = [...zhLeaves.keys()].sort()
    const enKeys = [...enLeaves.keys()].sort()

    const missingInEn = zhKeys.filter((key) => !enLeaves.has(key))
    const missingInZh = enKeys.filter((key) => !zhLeaves.has(key))

    expect(missingInEn, `en.json 缺少：${missingInEn.join(', ')}`).toEqual([])
    expect(missingInZh, `zh.json 缺少：${missingInZh.join(', ')}`).toEqual([])
  })

  it('没有空词条（空白页比缺词更难查）', () => {
    for (const [dict, name] of [
      [zhLeaves, 'zh'],
      [enLeaves, 'en']
    ] as const) {
      const empty = [...dict.entries()]
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key)
      expect(empty, `${name}.json 存在空词条：${empty.join(', ')}`).toEqual([])
    }
  })

  it('同一键的 {占位符} 名称在两门语言里一致（否则渲染出未替换的花括号）', () => {
    for (const [key, zhText] of zhLeaves) {
      const enText = enLeaves.get(key)
      if (enText === undefined) continue
      expect(placeholders(enText), `${key} 的占位符与中文版不一致`).toEqual(placeholders(zhText))
    }
  })

  it('**粗体** 标记成对出现', () => {
    for (const [dict, name] of [
      [zhLeaves, 'zh'],
      [enLeaves, 'en']
    ] as const) {
      for (const [key, text] of dict) {
        const markers = text.split('**').length - 1
        expect(markers % 2, `${name}.json ${key} 的 ** 标记未成对`).toBe(0)
      }
    }
  })
})

describe('落地页词典：英文侧不该残留未翻译的中文', () => {
  // 唯一允许的例外：FAQ 里**故意**举出中文占位符 `<<手机号>>` 作为对照，
  // 说明界面语言会决定占位符用词。
  const ALLOWED = new Set(['faq.items[5].a'])

  it('含汉字的英文词条只有已知的那一条', () => {
    const withHan = [...enLeaves.entries()]
      .filter(([, text]) => HAN.test(text))
      .map(([key]) => key)
      .sort()
    expect(withHan).toEqual([...ALLOWED].sort())
  })

  it('被允许的那条例外确实引用了中文占位符（而不是变成了别的什么）', () => {
    for (const key of ALLOWED) {
      expect(enLeaves.get(key)).toContain('<<手机号>>')
    }
  })

  it('元信息与区块标题都不是中文', () => {
    const important = ['meta.title', 'meta.description', 'hero.title', 'hero.subtitle']
    for (const key of important) {
      expect(HAN.test(enLeaves.get(key) ?? ''), `${key} 仍是中文`).toBe(false)
    }
  })
})

describe('落地页 i18n 工具函数', () => {
  it('默认语言在根路径，其余在 /<locale>/（且一律带部署子路径前缀）', () => {
    expect(localePath('zh')).toBe(`${siteBase}/`)
    expect(localePath('en')).toBe(`${siteBase}/en/`)
    // siteBase 归一化：根部署为空串，子路径部署形如 /context-watchdog（无尾斜杠）
    expect(siteBase.endsWith('/')).toBe(false)
    expect(siteBase === '' || siteBase.startsWith('/')).toBe(true)
    if (siteBase === '') {
      expect(localePath('zh')).toBe('/')
      expect(localePath('en')).toBe('/en/')
    }
  })

  it('语言互切', () => {
    expect(otherLocale('zh')).toBe('en')
    expect(otherLocale('en')).toBe('zh')
  })

  it('format 替换全部 {name}，且不碰其它花括号', () => {
    expect(format('共 {count} 位', { count: 12 })).toBe('共 12 位')
    expect(format('{a}-{a}-{b}', { a: 'x', b: 'y' })).toBe('x-x-y')
    // 正则示例里的 \d{6} 与插值同形——不能被当成占位符（与扩展侧同一个坑）
    expect(format('正则 \\d{6} 命中 {count} 处', { count: 3 })).toBe('正则 \\d{6} 命中 3 处')
  })

  it('splitBold 切出粗体段并丢掉空串', () => {
    expect(splitBold('普通**重点**普通')).toEqual([
      { text: '普通', bold: false },
      { text: '重点', bold: true },
      { text: '普通', bold: false }
    ])
    expect(splitBold('**通篇重点**')).toEqual([{ text: '通篇重点', bold: true }])
    expect(splitBold('没有标记')).toEqual([{ text: '没有标记', bold: false }])
  })
})
