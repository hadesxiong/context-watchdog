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
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderThirdPartyNotices } from './third-party-notices.mjs'

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
console.log('[postbuild] 第三方许可与 LICENSE 已写入 →', outDir)

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
