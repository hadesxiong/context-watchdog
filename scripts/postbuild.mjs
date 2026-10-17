// 构建后处理：把 Firefox 需要的 background.scripts 注回 dist/manifest.json
//
// 原因：CRXJS 只认 background.service_worker（构建时会把 scripts 键丢弃），
// 而 Firefox MV3 不支持 service_worker、只认 scripts（Firefox 121+ / Chrome 121+ 均可两者并存，
// 各取所需——Chrome 会忽略多余的 scripts，Firefox 会忽略 service_worker）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const manifestPath = resolve(here, '../dist/manifest.json')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

if (!manifest.background?.service_worker) {
  console.warn('[postbuild] 未找到 background.service_worker，跳过 scripts 注入')
  process.exit(0)
}

manifest.background.scripts = [manifest.background.service_worker]
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('[postbuild] 已注入 background.scripts（Firefox 事件页）:', manifest.background.scripts)
