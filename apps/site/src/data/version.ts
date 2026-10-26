// 版本号：构建时从**唯一真相源**注入
// `packages/extension/src/manifest.json` 是扩展版本号的唯一真相源（商店读的就是它），
// 手写一个必然在某次发版后与它不一致。astro.config.mjs 在配置阶段读 manifest，经
// vite.define 编译进产物。不在此处用 import.meta.url / cwd 拼路径读文件：本模块会被
// 打包进 prerender chunk，运行时 import.meta.url 指向 dist 而非源码，相对路径整体偏移。

/** 由 astro.config.mjs 的 vite.define 注入；见 apps/site/src/env.d.ts 的类型声明 */
export const extensionVersion: string = __EXTENSION_VERSION__

/** 唯一真相源的路径（页脚/文档里引用，避免各处手写） */
export const extensionManifestPath = 'packages/extension/src/manifest.json'

if (!/^\d+\.\d+\.\d+/.test(extensionVersion)) {
  throw new Error(`[site] 注入的扩展版本号不合法：${JSON.stringify(extensionVersion)}`)
}
