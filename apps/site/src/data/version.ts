// 版本号：构建时从**唯一真相源**注入
//
// `packages/extension/src/manifest.json` 是扩展版本号的唯一真相源（商店读的就是它）。
// 落地页手写一个版本号，必然在某次发版后与它不一致——而且是那种没人会立刻发现的不一致。
//
// 注入方式：astro.config.mjs 在配置阶段读 manifest，再经 vite.define 把版本号
// 编译进产物（__EXTENSION_VERSION__）。
//
// 为什么不用 import.meta.url 拼路径读文件：这个模块会被打包进 prerender chunk，
// 运行时 import.meta.url 指向的是 **dist 里的 chunk**，而不是源码位置，
// 相对路径会整体偏移（实测会去找 apps/site/packages/...）。
// 也不用 cwd：cwd 取决于从哪里启动 astro，不可靠。配置阶段读文件没有这两个问题。

/** 由 astro.config.mjs 的 vite.define 注入；见 apps/site/src/env.d.ts 的类型声明 */
export const extensionVersion: string = __EXTENSION_VERSION__

/** 唯一真相源的路径（页脚/文档里引用，避免各处手写） */
export const extensionManifestPath = 'packages/extension/src/manifest.json'

if (!/^\d+\.\d+\.\d+/.test(extensionVersion)) {
  throw new Error(`[site] 注入的扩展版本号不合法：${JSON.stringify(extensionVersion)}`)
}
