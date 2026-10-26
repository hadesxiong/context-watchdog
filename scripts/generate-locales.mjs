// 从单一 catalog 生成 Chrome 的 _locales/*/messages.json：UI 与 manifest / service worker 共用
// 一份词条，生成而非手抄才不会漂移（两个消费方与键名约束见 docs/spec.md §16）。
// 值里的 $ 是 messages.json 的占位符语法，写入时转义成 $$。
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
