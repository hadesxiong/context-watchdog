// 构建后处理：chrome → dist/（manifest 原样）；firefox → dist-firefox/（Chrome 键 → Firefox 键）。
// 两个目标共用同一份输入 manifest（CRXJS 必须靠 side_panel / service_worker 发现打包入口，
// 分叉输入会漏打包），所以 Firefox 的键转换集中在这里做一次，清单与理由见 docs/spec.md §11。
import { readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderThirdPartyNotices } from './third-party-notices.mjs'
import { writeLocales } from './generate-locales.mjs'

const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome'
const here = dirname(fileURLToPath(import.meta.url))
const outDir = target === 'firefox' ? 'dist-firefox' : 'dist'
const manifestPath = resolve(here, `../${outDir}/manifest.json`)

// 许可声明随包分发（Apache-2.0 §4(c)、MIT 通知义务）；运行时下载的模型不入包，只在清单末尾列出备查
const notices = renderThirdPartyNotices()
writeFileSync(resolve(here, '../THIRD-PARTY-NOTICES.txt'), notices)
copyFileSync(resolve(here, '../THIRD-PARTY-NOTICES.txt'), resolve(here, `../${outDir}/THIRD-PARTY-NOTICES.txt`))
copyFileSync(resolve(here, '../LICENSE'), resolve(here, `../${outDir}/LICENSE`))
// NOTICE 必须一并入包（Apache-2.0 §4(d) 署名义务）：漏了构建照样成功，check-versions 有硬护栏盯着
copyFileSync(resolve(here, '../NOTICE'), resolve(here, `../${outDir}/NOTICE`))
console.log('[postbuild] 第三方许可、LICENSE 与 NOTICE 已写入 →', outDir)

// __MSG_*__ 与 SW 的 chrome.i18n.getMessage 都读 _locales，词条与 UI 字典同源（见 scripts/generate-locales.mjs）
console.log('[postbuild] _locales 已生成 →', writeLocales(resolve(here, `../${outDir}`)).join(', '))

// __MSG_xxx__ 缺 key 不会让构建报错——浏览器会直接把 __MSG_ext_name__ 当名字显示出来，所以反过来校验 _locales 里确实存在被引用的 key。
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

// 设计 token 内联护栏：Tailwind 4 的 @import 解析器会静默丢弃它不认识的路径，产物 CSS 于是没有
// :root 变量、所有颜色失效，而构建零警告——这里变成硬失败。token 唯一来源 packages/design-tokens/tokens.css。
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

// Tailwind 内容扫描范围护栏：root 指错地方（或扩展目录被排除）时产物一个 utility 都不剩、构建零
// 警告，这里抽查模板实际用到的 utility，把「扫描失效」变成硬失败（扫描过宽属体积问题，不在此拦）。
const requiredUtilities = ['.gap-2', '.text-xs', '.w-full', '.mb-1']
const missingUtilities = requiredUtilities.filter((u) => !cssBundle.includes(u))
if (missingUtilities.length) {
  console.error(`[postbuild] ✗ 产物 CSS 缺少 Tailwind utility：${missingUtilities.join(', ')}`)
  console.error('[postbuild]   说明内容扫描范围失效，检查 vite.config.ts 的 root 与 @source')
  process.exit(1)
}
console.log('[postbuild] Tailwind 扫描范围正常 ✓  (' + requiredUtilities.join(' ') + ')')

// ORT wasm 单例护栏：多份 ort-wasm-*.wasm 说明依赖树里有两个 onnxruntime-web，两个实例各自建内存、丢掉共享信号（SharedArrayBuffer 多线程），构建期硬失败
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

// 后台：service_worker → scripts（Firefox 不接受 MV3 的 service_worker 键；CRXJS 已输出 service-worker-loader.js）
if (!manifest.background?.service_worker) {
  console.warn('[postbuild] 未找到 background.service_worker，跳过转换')
  process.exit(0)
}
manifest.background.scripts = [manifest.background.service_worker]
delete manifest.background.service_worker

// 侧栏：side_panel → sidebar_action（路径不变，CRXJS 已按 side_panel 打包该页面）。不写
// default_position：MDN 的 sidebar_action 没有该键，Firefox 会报「An unexpected property」。
if (manifest.side_panel?.default_path) {
  manifest.sidebar_action = {
    default_title: 'ContextWatchdog · AI脱敏助手',
    default_panel: manifest.side_panel.default_path
  }
  delete manifest.side_panel
}

// 权限：移除 Firefox 未知的 sidePanel / offscreen（Firefox 没有 offscreen API，AMO 审核会标）；
// S1 的宿主在 Firefox 上不生效，回退到侧栏内加载
if (Array.isArray(manifest.permissions)) {
  manifest.permissions = manifest.permissions.filter((p) => p !== 'sidePanel' && p !== 'offscreen')
}

// gecko id
manifest.browser_specific_settings = {
  gecko: {
    id: 'contextwatchdog@contextwatchdog.invalid',
    strict_min_version: '121.0'
  }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('[postbuild] Firefox 目标：service_worker → scripts、side_panel → sidebar_action →', outDir)
