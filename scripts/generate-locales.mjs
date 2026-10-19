// 从单一 catalog 生成 Chrome 的 _locales/*/messages.json
//
// 为什么要有这一层生成：
//   · UI 走 packages/extension/src/i18n（需要运行时切换语言，因此字典必须进包）；
//   · manifest 的 __MSG_*__ 与 service worker 的 chrome.i18n.getMessage 只能读
//     _locales/*/messages.json（Chrome 原生机制，且不必把字典打进 SW 包）。
// 两者共用同一份 JSON —— 生成而不是手抄，就不会漂移。
//
// 键名约束：Chrome 只接受 [a-zA-Z0-9_@]，因此 catalog 一律用 snake_case。
// 值里的 $ 在 messages.json 里是占位符语法，必须转义成 $$。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const CATALOG_DIR = resolve(ROOT, 'packages/extension/src/i18n/locales')

/** 列出 catalog 里声明的 locale（由文件名决定，新增语言只需加一个 JSON） */
export const listCatalogLocales = () =>
  readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()

export const readCatalog = (locale) =>
  JSON.parse(readFileSync(resolve(CATALOG_DIR, `${locale}.json`), 'utf8'))

/** catalog（扁平 key → string）→ Chrome messages.json（key → { message }） */
export const toChromeMessages = (catalog) => {
  const out = {}
  for (const [key, value] of Object.entries(catalog)) {
    if (!/^[a-zA-Z0-9_@]+$/.test(key)) {
      throw new Error(`[locales] 键 "${key}" 不符合 Chrome messages.json 的字符集（只允许 a-z A-Z 0-9 _ @）`)
    }
    if (typeof value !== 'string') {
      throw new Error(`[locales] 键 "${key}" 的值必须是字符串`)
    }
    out[key] = { message: value.replace(/\$/g, '$$$$') }
  }
  return out
}

/** 把全部 locale 写进 <outDir>/_locales/<locale>/messages.json */
export const writeLocales = (outDir) => {
  const written = []
  for (const locale of listCatalogLocales()) {
    const dir = resolve(outDir, '_locales', locale)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'messages.json'), `${JSON.stringify(toChromeMessages(readCatalog(locale)), null, 2)}\n`)
    written.push(locale)
  }
  return written
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = resolve(ROOT, process.argv[2] ?? 'dist')
  if (!existsSync(outDir)) {
    console.error(`[locales] 输出目录不存在：${outDir}（先跑构建）`)
    process.exit(1)
  }
  console.log('[locales] 已生成 →', writeLocales(outDir).join(', '))
}
