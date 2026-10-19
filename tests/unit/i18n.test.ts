// i18n 防漂移护栏
//
// i18n 最容易出的问题不是「翻错了」，而是**悄悄漏掉**：
//   · 新加一条文案只写了中文，英文用户看到中文；
//   · 词条加进 catalog 但忘了同步另一门语言；
//   · 模板里 t('xxx') 拼错，运行时回退成 key 显示（不报错、不崩溃）；
//   · manifest 引用的 __MSG_*__ 没有对应词条，浏览器直接把占位符当名字显示。
// 这四类都是「构建全绿、界面才露馅」，所以必须由测试兜住。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const EXT_SRC = resolve(ROOT, 'packages/extension/src')
const LOCALES = ['en', 'zh_CN'] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const locales = (await import('../../scripts/generate-locales.mjs')) as any

const {
  generatePlaceholder,
  parsePlaceholder,
  isValidPlaceholder,
  setPlaceholderLocale,
  getPlaceholderLocale
} = await import('@engine/replacer/placeholder')

const readCatalog = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(EXT_SRC, `i18n/locales/${locale}.json`), 'utf8'))

const walk = (dir: string, ext: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full, ext)
    return entry.name.endsWith(ext) ? [full] : []
  })

/** 剥离注释：注释是给开发者看的中文，不属于「未翻译的界面文案」 */
const stripComments = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const VUE_FILES = walk(EXT_SRC, '.vue')
const ALL_SOURCE_FILES = [...walk(EXT_SRC, '.vue'), ...walk(EXT_SRC, '.ts')]

const en = readCatalog('en')
const zh = readCatalog('zh_CN')

/** DetectionType 的权威列表：直接从类型定义解析，新增类型会被下面的护栏自动覆盖 */
const DETECTION_TYPES = (() => {
  const typesSource = readFileSync(resolve(ROOT, 'packages/engine/src/types/index.ts'), 'utf8')
  const union = typesSource.match(/export type DetectionType =([\s\S]*?)\n\n/)
  if (!union) throw new Error('未能从 types/index.ts 解析出 DetectionType')
  return [...union[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
})()

describe('i18n - 词条完整性', () => {
  it('两门语言的 key 集合完全一致（缺一条都会让某语言回退到另一语言）', () => {
    const enKeys = Object.keys(en).sort()
    const zhKeys = Object.keys(zh).sort()
    expect(zhKeys.filter((k) => !enKeys.includes(k))).toEqual([])
    expect(enKeys.filter((k) => !zhKeys.includes(k))).toEqual([])
  })

  it('没有空词条', () => {
    const empty = Object.entries({ ...en, ...zh })
      .filter(([, value]) => !value.trim())
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('词条值里没有残留的未替换占位符以外的花括号', () => {
    // {count} / {name} / {error} 是允许的。
    // 只检查「标识符形状」的花括号：正则示例里的 \d{6} 属于正常内容，
    // 而拼错的占位符（如 {Count}）一定会命中这条。
    const allowed = new Set(['count', 'name', 'error'])
    const offenders = Object.entries({ ...en, ...zh }).flatMap(([key, value]) =>
      [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
        .filter((m) => !allowed.has(m[1]))
        .map(() => key)
    )
    expect(offenders).toEqual([])
  })
})

describe('i18n - 与 Chrome _locales 的一致性与合法性', () => {
  it('catalog 目录与测试里声明的语言一致', () => {
    expect(locales.listCatalogLocales()).toEqual([...LOCALES].sort())
  })

  it('所有 key 都符合 Chrome messages.json 的字符集（否则 _locales 生成会抛错）', () => {
    for (const locale of LOCALES) {
      expect(() => locales.toChromeMessages(readCatalog(locale))).not.toThrow()
    }
  })

  it('生成物与手写 catalog 逐键等价（$ 必须转义，否则 Chrome 会当占位符解析）', () => {
    for (const locale of LOCALES) {
      const messages = locales.toChromeMessages(readCatalog(locale))
      expect(Object.keys(messages).sort()).toEqual(Object.keys(readCatalog(locale)).sort())
      for (const [key, value] of Object.entries(readCatalog(locale))) {
        expect(messages[key].message).toBe(value.replace(/\$/g, '$$$$'))
      }
    }
  })

  it('manifest 里引用的 __MSG_*__ 都在默认语言有词条', () => {
    const manifest = JSON.parse(readFileSync(resolve(EXT_SRC, 'manifest.json'), 'utf8'))
    const refs = new Set<string>()
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        for (const m of value.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) refs.add(m[1])
      } else if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    collect(manifest)
    expect(refs.size).toBeGreaterThan(0)
    const missing = [...refs].filter((key) => !(key in en))
    expect(missing).toEqual([])
    // default_locale 必须真实存在，否则浏览器找不到默认词条
    expect(LOCALES).toContain(manifest.default_locale)
  })
})

describe('i18n - 代码里用到的 key 必须存在', () => {
  it('所有 t(\'...\') 字面量都能在 catalog 里找到', () => {
    const missing: string[] = []
    for (const file of ALL_SOURCE_FILES) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
        if (!(match[1] in en)) missing.push(`${file.replace(ROOT + '/', '')}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('每个 DetectionType 都有 type_<T> 词条（新增类型必须补标签）', () => {
    expect(DETECTION_TYPES.length).toBeGreaterThan(10)
    const missing = DETECTION_TYPES.flatMap((type) =>
      en[`type_${type}`] && zh[`type_${type}`] ? [] : [type]
    )
    expect(missing).toEqual([])
  })

  it('每个内置 Profile 都有 profile_<id>_name / _desc 词条', () => {
    // 从源码里解析 id，新增内置档案会自动被这条测试覆盖（不必回来改测试）
    const profilesSource = readFileSync(resolve(ROOT, 'packages/engine/src/detector/profiles.ts'), 'utf8')
    const builtinBlock = profilesSource.match(/BUILTIN_PROFILES[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1] ?? ''
    const ids = [...builtinBlock.matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(2)
    const missing = ids.flatMap((id) =>
      en[`profile_${id}_name`] && en[`profile_${id}_desc`] && zh[`profile_${id}_name`] && zh[`profile_${id}_desc`]
        ? []
        : [id]
    )
    expect(missing).toEqual([])
  })

  it('每个 RuleCategory 都有 ps_category_* 词条（自定义档案编辑器用它渲染勾选项）', () => {
    const typesSource = readFileSync(resolve(ROOT, 'packages/engine/src/types/index.ts'), 'utf8')
    const union = typesSource.match(/export type RuleCategory =([\s\S]*?)\n/)
    expect(union).not.toBeNull()
    const categories = [...union![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect(categories.length).toBeGreaterThan(2)
    const missing = categories.flatMap((cat) =>
      en[`ps_category_${cat}`] && zh[`ps_category_${cat}`] ? [] : [cat]
    )
    expect(missing).toEqual([])
  })
})

describe('i18n - .vue 里不得残留未翻译的中文', () => {
  it('剥掉注释后，模板与脚本中不再有汉字', () => {
    const offenders: string[] = []
    for (const file of VUE_FILES) {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
      lines.forEach((line, index) => {
        if (/[\u4e00-\u9fff]/.test(line)) {
          offenders.push(`${file.replace(ROOT + '/', '')}:${index + 1}  ${line.trim().slice(0, 80)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('扫描范围有效（护栏自身未失效）', () => {
    expect(VUE_FILES.length).toBeGreaterThan(10)
  })
})

describe('i18n - 占位符语言（占位符会写进用户复制出去的内容）', () => {
  it('切到 en 后用英文名，切回 zh_CN 复原，默认仍是 zh_CN', () => {
    expect(getPlaceholderLocale()).toBe('zh_CN')
    expect(generatePlaceholder('PHONE', 1)).toBe('<<手机号>>')
    setPlaceholderLocale('en')
    expect(generatePlaceholder('PHONE', 1)).toBe('<<PHONE>>')
    expect(generatePlaceholder('PHONE', 2)).toBe('<<PHONE:2>>')
    setPlaceholderLocale('zh_CN')
    expect(generatePlaceholder('PHONE', 1)).toBe('<<手机号>>')
  })

  it('两种语言下每个类型都能解析回自身（名称不冲突、切换语言后旧映射表仍可还原）', () => {
    const mismatches: string[] = []
    for (const locale of ['zh_CN', 'en'] as const) {
      setPlaceholderLocale(locale)
      for (const type of DETECTION_TYPES) {
        for (const index of [1, 2]) {
          const placeholder = generatePlaceholder(type as never, index)
          const parsed = parsePlaceholder(placeholder)
          if (!parsed || parsed.type !== type || parsed.index !== index) {
            mismatches.push(`${locale} ${type}#${index} → ${placeholder}`)
          }
          expect(isValidPlaceholder(placeholder)).toBe(true)
        }
      }
    }
    setPlaceholderLocale('zh_CN')
    expect(mismatches).toEqual([])
  })
})
