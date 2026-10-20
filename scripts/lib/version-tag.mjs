// 发布标签的唯一规则来源（scripts/check-versions.mjs 与单测共用）
//
// 形态：`<version>-<target>`，例如 1.0.0-ext。
//
// 为什么不用 v 前缀：tag 名要能直接读成「哪端、哪一版」，`v1.0.0` 只是把版本号
// 又抄了一遍，没有增加任何信息。
//
// 为什么用后缀而不是前缀（如 `ext/1.0.0`）：同一版本的多个端按字典序自然聚在
// 一起 —— `1.0.0-app` < `1.0.0-ext` < `1.0.0-site` —— `git tag --sort=refname`
// 与人眼扫描都是连续的。
//
// 为什么 target 只有 ext/site/app：它们对应**发布产物**的边界，而不是渠道边界。
// 一个 -ext Release 同时挂 Chrome 与 Firefox 两个包，所以不用 -crx（Firefox 那个
// 不是 crx，会名不副实）。落地页有 -site，本地应用（后续线②）用 -app。
//
// 为什么 core 不允许预发布号：`1.0.0-beta-ext` 里 beta 和 ext 都会占用 semver 的
// pre-release 段，无法区分「beta 版的扩展」与「扩展的 beta 通道」。要发预发布，
// 版本号本身写全（例如 1.0.0-rc.1）再由 target 收尾会变成 1.0.0-rc.1-ext —— 排序
// 语义会变得不可预期，所以这里直接禁止。

export const TAG_TARGETS = ['ext', 'site', 'app']

/** 只允许三段数字：预发布/构建元数据会和 target 后缀抢位置 */
const CORE_VERSION = /^\d+\.\d+\.\d+$/
const TAG_PATTERN = /^(\d+\.\d+\.\d+)-(ext|site|app)$/

/**
 * 拼出某个端在某版本下的 tag。
 * @param {string} version 三段数字版本号（与 manifest / package.json 一致）
 * @param {'ext'|'site'|'app'} target
 * @returns {string}
 */
export function formatVersionTag(version, target) {
  if (!CORE_VERSION.test(version)) {
    throw new Error(
      `版本号必须是三段数字（收到 ${JSON.stringify(version)}）：` +
        `预发布号会与 target 后缀抢位置，请把预发布信息并入版本主体`
    )
  }
  if (!TAG_TARGETS.includes(target)) {
    throw new Error(`未知的发布目标 ${JSON.stringify(target)}，可选：${TAG_TARGETS.join(' / ')}`)
  }
  return `${version}-${target}`
}

/**
 * 解析 tag；不是本项目的发布标签时返回 null（普通 tag 不该让检查失败）。
 * @param {string} tag
 * @returns {{ version: string, target: 'ext'|'site'|'app' } | null}
 */
export function parseVersionTag(tag) {
  const match = TAG_PATTERN.exec(tag)
  if (!match) return null
  return { version: match[1], target: /** @type {'ext'|'site'|'app'} */ (match[2]) }
}

/**
 * 某个版本对应的全部 tag（check-versions 用它一次性查重）。
 * @param {string} version
 * @returns {string[]}
 */
export function tagsForVersion(version) {
  return TAG_TARGETS.map((target) => formatVersionTag(version, target))
}

/**
 * tag 是否恰好对应这个版本（与 target 无关）。
 * 用途：发布前确认「要打的 tag 里的版本号 == manifest 里的版本号」。
 * @param {string} tag
 * @param {string} version
 * @returns {boolean}
 */
export function tagMatchesVersion(tag, version) {
  const parsed = parseVersionTag(tag)
  return parsed !== null && parsed.version === version
}
