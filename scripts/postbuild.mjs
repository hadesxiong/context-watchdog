// 构建后处理：按目标浏览器整理 manifest
//
//   node scripts/postbuild.mjs chrome    → dist/（无需处理）
//   node scripts/postbuild.mjs firefox   → dist-firefox/（Chrome 键 → Firefox 键）
//
// 两个目标共用同一份输入 manifest（CRXJS 必须靠 side_panel / service_worker
// 发现打包入口，分叉输入会漏打包），所以 Firefox 的键转换集中在这里做一次：
//   - background.service_worker → background.scripts
//     （Firefox MV3 不支持 service_worker；Chrome 形态的 service_worker 会让
//      Firefox 报「background.scripts requires manifest version of 2 or lower」）
//   - side_panel → sidebar_action（Firefox 不识别 side_panel）
//   - 移除 sidePanel 权限（Firefox 未知权限，审核会标）
//   - 补 browser_specific_settings.gecko id（本地加载与签名需要稳定 id）
import { readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderThirdPartyNotices } from './third-party-notices.mjs'
import { writeLocales } from './generate-locales.mjs'

const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = target === 'firefox' ? 'dist-firefox' : 'dist'
const manifestPath = resolve(here, `../${outDir}/manifest.json`)

// 两个目标都必须随附第三方许可声明（Apache-2.0 §4(c)、MIT 的版权与许可通知要求）。
// 运行时下载的模型不在包内，不计入分发组件，但在清单末尾单独列出以供透明度审查。
const notices = renderThirdPartyNotices()
writeFileSync(resolve(here, '../THIRD-PARTY-NOTICES.txt'), notices)
copyFileSync(resolve(here, '../THIRD-PARTY-NOTICES.txt'), resolve(here, `../${outDir}/THIRD-PARTY-NOTICES.txt`))
// LICENSE 一并入包：商店与用户都能在产物内直接核验许可全文
copyFileSync(resolve(here, '../LICENSE'), resolve(here, `../${outDir}/LICENSE`))
// NOTICE 必须一并入包。这不是「顺手多带一个文件」：Apache-2.0 §4(d) 明确要求
// 分发衍生作品时随附 NOTICE 里的署名声明。本项目恰好有 NOTICE（作者署名 + 商标
// 声明 + 专利声明），漏了它就是漏了一条许可义务 —— 而且漏得毫无症状：
// 构建照样成功，只有真的去看产物才会发现。因此 check-versions 里有一条硬护栏。
copyFileSync(resolve(here, '../NOTICE'), resolve(here, `../${outDir}/NOTICE`))
console.log('[postbuild] 第三方许可、LICENSE 与 NOTICE 已写入 →', outDir)

// manifest 用的是 __MSG_ext_name__ / __MSG_ext_description__，需要 _locales 才能被
// 浏览器替换掉；service worker 的 chrome.i18n.getMessage 也读这里。
// 两者与本扩展的 UI 字典同源（见 scripts/generate-locales.mjs 的头注释）。
console.log('[postbuild] _locales 已生成 →', writeLocales(resolve(here, `../${outDir}`)).join(', '))

// manifest 里的 __MSG_xxx__ 由浏览器在加载时替换，产物里保留原样是对的。
// 但这意味着**少一个 key 不会被构建报错**——浏览器会直接把 __MSG_ext_name__
// 当成名字显示出来。所以这里反过来校验 _locales 里确实存在被引用的 key。
const builtManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const referencedKeys = new Set()
const collectMsgRefs = (value) => {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) referencedKeys.add(m[1])
  } else if (Array.isArray(value)) {
    value.forEach(collectMsgRefs)
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(collectMsgRefs)
  }
}
collectMsgRefs(builtManifest)
const defaultLocale = builtManifest.default_locale ?? 'en'
const defaultMessages = JSON.parse(readFileSync(resolve(here, `../${outDir}/_locales/${defaultLocale}/messages.json`), 'utf8'))
const missingMsgKeys = [...referencedKeys].filter((k) => !(k in defaultMessages))
if (missingMsgKeys.length) {
  console.error(`[postbuild] ✗ manifest 引用了 _locales 中不存在的键：${missingMsgKeys.join(', ')}`)
  process.exit(1)
}
console.log(`[postbuild] manifest 本地化键可解析 ✓  (${[...referencedKeys].join(', ')} → ${defaultLocale})`)

// 设计 token 内联护栏。
// Tailwind 4 的 @import 解析器只内联同目录/别名可达的路径，会静默丢弃它不认识的
// @import —— 结果是产物 CSS 里完全没有 :root 变量，所有颜色失效，而构建**零警告**。
// 这里把该回归变成硬失败。token 唯一来源：packages/design-tokens/tokens.css。
const cssFiles = readdirSync(resolve(here, `../${outDir}/assets`)).filter((f) => f.endsWith('.css'))
const cssBundle = cssFiles.map((f) => readFileSync(resolve(here, `../${outDir}/assets/${f}`), 'utf8')).join('\n')
for (const token of ['--background:', '--foreground:', '--primary:', '--radius:']) {
  if (!cssBundle.includes(token)) {
    console.error(`[postbuild] ✗ 产物 CSS 缺少设计 token ${token}`)
    console.error('[postbuild]   检查 src/style.css 的 @import "@tokens/tokens.css" 是否被 Tailwind 静默丢弃')
    process.exit(1)
  }
}
console.log('[postbuild] 设计 token 已内联（亮色 + 暗色）✓')

// Tailwind 内容扫描范围护栏。
// Tailwind 4 按 vite root 决定要扫哪些文件；root 一旦指向错的地方（或扩展目录被
// 排除），产物里就一个 utility 都不剩——UI 全文失去样式，而构建**零警告**。
// 这里抽查几个模板里确实用到的 utility，把「扫描失效」变成硬失败。
// （反过来，扫描范围过宽也会把 package-lock.json 里的英文单词当成类名，多出
//  .container / .static 这类无用规则；那属于体积问题，不在这里拦截。）
const requiredUtilities = ['.gap-2', '.text-xs', '.w-full', '.mb-1']
const missingUtilities = requiredUtilities.filter((u) => !cssBundle.includes(u))
if (missingUtilities.length) {
  console.error(`[postbuild] ✗ 产物 CSS 缺少 Tailwind utility：${missingUtilities.join(', ')}`)
  console.error('[postbuild]   说明内容扫描范围失效，检查 vite.config.ts 的 root 与 @source')
  process.exit(1)
}
console.log('[postbuild] Tailwind 扫描范围正常 ✓  (' + requiredUtilities.join(' ') + ')')

// ONNX Runtime 单例护栏。
// ORT 的 wasm 后端依赖共享内存信号（SharedArrayBuffer）做多线程；产物里出现多份
// ort-wasm-*.wasm 通常意味着依赖树里存在两个不同版本的 onnxruntime-web，会让两个
// 实例各自建内存、丢掉共享信号。这里把它变成构建期硬失败，而不是运行时怪报错。
const ortWasm = readdirSync(resolve(here, `../${outDir}/assets`)).filter((f) => f.endsWith('.wasm'))
if (ortWasm.length !== 1) {
  console.error(`[postbuild] ✗ 产物中 ort-wasm 文件数 = ${ortWasm.length}，应恰好为 1`)
  console.error('[postbuild]   检查依赖树是否出现多版本 onnxruntime-web（npm ls onnxruntime-web）')
  console.error(`[postbuild]   实际文件：${ortWasm.join(', ') || '(无)'}`)
  process.exit(1)
}
console.log('[postbuild] ort-wasm 单例 ✓  (' + ortWasm[0] + ')')

if (target !== 'firefox') {
  console.log('[postbuild] Chrome 目标：manifest 无需处理 →', outDir)
  process.exit(0)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// 后台：service_worker → scripts（CRXJS 已输出 service-worker-loader.js）
if (!manifest.background?.service_worker) {
  console.warn('[postbuild] 未找到 background.service_worker，跳过转换')
  process.exit(0)
}
manifest.background.scripts = [manifest.background.service_worker]
delete manifest.background.service_worker

// 侧栏：side_panel → sidebar_action（路径不变，CRXJS 已按 side_panel 打包该页面）
if (manifest.side_panel?.default_path) {
  manifest.sidebar_action = {
    default_title: 'PasteGuard - AI脱敏助手',
    default_panel: manifest.side_panel.default_path,
    default_position: 'right'
  }
  delete manifest.side_panel
}

// 权限：移除 Firefox 未知的 sidePanel
if (Array.isArray(manifest.permissions)) {
  manifest.permissions = manifest.permissions.filter((p) => p !== 'sidePanel')
}

// gecko id
manifest.browser_specific_settings = {
  gecko: {
    id: 'pasteguard@pasteguard.dev',
    strict_min_version: '121.0'
  }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('[postbuild] Firefox 目标：service_worker → scripts、side_panel → sidebar_action →', outDir)
