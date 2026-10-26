// 发布标签的唯一规则来源（scripts/check-versions.mjs 与单测共用）。形态 `<version>-<target>`
// （如 1.0.0-ext），不用 v 前缀：tag 要能直接读出「哪端哪一版」。target 取后缀而非前缀：同版本
// 多端按字典序连续（1.0.0-app < 1.0.0-ext < 1.0.0-site），排序与人眼扫描都不跳。
// core 禁止预发布号：`1.0.0-beta-ext` 里 beta 与 ext 都占 semver 的 pre-release 段，
// 无法区分「beta 版扩展」与「扩展的 beta 通道」。

export const TAG_TARGETS = ['ext', 'site', 'app']

/** 只允许三段数字：预发布/构建元数据会和 target 后缀抢位置 */
const CORE_VERSION = /^\d+\.\d+\.\d+$/
const TAG_PATTERN = /^(\d+\.\d+\.\d+)-(ext|site|app)$/

/**
 * 拼出某个端在某版本下的 tag。
 * @param {string} version 三段数字版本号（与 manifest / package.json 一致）
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
 * @returns {{ version: string, target: 'ext'|'site'|'app' } | null}
 */
export function parseVersionTag(tag) {
  const match = TAG_PATTERN.exec(tag)
  if (!match) return null
  return { version: match[1], target: /** @type {'ext'|'site'|'app'} */ (match[2]) }
}

/** 某个版本对应的全部 tag（check-versions 用它一次性查重）。 */
export function tagsForVersion(version) {
  return TAG_TARGETS.map((target) => formatVersionTag(version, target))
}

/** tag 是否恰好对应这个版本（与 target 无关）——发布前校验「tag 里的版本号 == manifest 版本号」。 */
export function tagMatchesVersion(tag, version) {
  const parsed = parseVersionTag(tag)
  return parsed !== null && parsed.version === version
}
