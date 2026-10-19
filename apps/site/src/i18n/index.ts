// 站点字典与语言切换
//
// 与扩展的 i18n 是两套东西，但**术语保持一致**（同一件事在扩展里叫「粘贴自动拦截」，
// 站点上不该叫别的）。这里不做运行时切换：静态站点每个语言一个页面
// （/ 为中文，/en/ 为英文），语言在构建时就定死了，因此零客户端 JS。
import zh from './zh.json'
import en from './en.json'

/** 把 JSON 推断出的字面量类型放宽成 string，同时保留结构 */
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Widen<U>[]
    : { [K in keyof T]: Widen<T[K]> }

export type SiteDict = Widen<typeof zh>

// 这行是**类型层面的**翻译完整性检查：en.json 少任何一条、或类型对不上，都编译不过。
// 多出来的键由 tests/unit/siteI18n.test.ts 兜住（类型系统不管多余属性）。
const enChecked: SiteDict = en

export const dictionaries: Record<SiteLocale, SiteDict> = { zh, en: enChecked }
export type SiteLocale = 'zh' | 'en'

export const locales: SiteLocale[] = ['zh', 'en']

/** 站点根路径：默认语言（中文）在 /，其余在 /<locale>/ */
export const localePath = (locale: SiteLocale): string => (locale === 'zh' ? '/' : `/${locale}/`)

/** 另一门语言的路径（用于页头语言切换） */
export const otherLocale = (locale: SiteLocale): SiteLocale => (locale === 'zh' ? 'en' : 'zh')

/** 语言自身的显示名——**不翻译**，永远显示目标语言的自称 */
export const localeLabel = (locale: SiteLocale): string => (locale === 'zh' ? '中文' : 'English')

export const dict = (locale: SiteLocale): SiteDict => dictionaries[locale]

/**
 * 极简插值：把 {name} 换成值。
 * 用 split/join 而不是 replaceAll —— 与扩展侧同一个理由，避开 lib 版本问题。
 */
export const format = (template: string, params: Record<string, string | number>): string => {
  let text = template
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{${name}}`).join(String(value))
  }
  return text
}

/** 文案里用 **粗体** 标记重点；渲染层负责切成 <strong>（见 Rich.astro） */
export const splitBold = (text: string): Array<{ text: string; bold: boolean }> =>
  text
    .split(/\*\*(.+?)\*\*/g)
    .map((chunk, index) => ({ text: chunk, bold: index % 2 === 1 }))
    .filter((chunk) => chunk.text !== '')
