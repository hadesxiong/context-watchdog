import { describe, expect, it } from 'vitest'
import manifest from '../../packages/extension/src/manifest.json'
import {
  TAG_TARGETS,
  formatVersionTag,
  parseVersionTag,
  tagMatchesVersion,
  tagsForVersion
} from '../../scripts/lib/version-tag.mjs'

// 发布标签的护栏。
//
// tag 是发布流程里唯一「写错了也不会让构建失败」的东西 —— 打错了只能删掉重打，
// 而已经推送/被引用的 tag 删起来很脏。所以把规则做成纯函数并在这里钉死：
// 形态、排序、以及「旧方案必须认不出来」（否则改名时漏掉一处，check-versions
// 会以为标签没被占用）。

describe('formatVersionTag', () => {
  it('拼出 <version>-<target>', () => {
    expect(formatVersionTag('1.0.0', 'ext')).toBe('1.0.0-ext')
    expect(formatVersionTag('2.3.4', 'site')).toBe('2.3.4-site')
    expect(formatVersionTag('1.0.0', 'app')).toBe('1.0.0-app')
  })

  it('拒绝预发布版本号（会与 target 抢 pre-release 段）', () => {
    expect(() => formatVersionTag('1.0.0-rc.1', 'ext')).toThrow(/三段数字/)
    expect(() => formatVersionTag('1.0.0+meta', 'ext')).toThrow(/三段数字/)
    expect(() => formatVersionTag('1.0', 'ext')).toThrow(/三段数字/)
  })

  it('拒绝未知 target', () => {
    expect(() => formatVersionTag('1.0.0', 'crx')).toThrow(/未知的发布目标/)
  })
})

describe('tagsForVersion', () => {
  it('一个版本对应三个端，且共享同一前缀（在 git tag 里自然聚成一组）', () => {
    const tags = tagsForVersion('1.0.0')
    expect(tags).toEqual(['1.0.0-ext', '1.0.0-site', '1.0.0-app'])
    expect(tags).toHaveLength(TAG_TARGETS.length)
    // 前缀一致 = 排序后它们必然相邻，不会被别的版本的 tag 隔开
    expect(tags.every((tag) => tag.startsWith('1.0.0-'))).toBe(true)
    expect(new Set(tags.map((tag) => parseVersionTag(tag)?.target)).size).toBe(TAG_TARGETS.length)
  })

  it('不同版本的 tag 不会互相匹配', () => {
    expect(tagsForVersion('1.0.0')).not.toEqual(tagsForVersion('1.0.1'))
  })
})

describe('parseVersionTag', () => {
  it('往返一致', () => {
    for (const target of TAG_TARGETS) {
      const tag = formatVersionTag('1.2.3', target)
      expect(parseVersionTag(tag)).toEqual({ version: '1.2.3', target })
    }
  })

  it('旧方案与非法形态一律返回 null', () => {
    for (const tag of [
      'ext-v1.0.0',
      'site-v1.0.0',
      'v1.0.0',
      '1.0.0',
      '1.0.0-crx',
      '1.0.0-ext.1',
      '1.0.0-EXT',
      '1.0.0-ext-beta',
      'nightly'
    ]) {
      expect(parseVersionTag(tag), tag).toBeNull()
    }
  })
})

describe('tagMatchesVersion', () => {
  it('只比版本核心，不比 target', () => {
    expect(tagMatchesVersion('1.0.0-ext', '1.0.0')).toBe(true)
    expect(tagMatchesVersion('1.0.0-app', '1.0.0')).toBe(true)
    expect(tagMatchesVersion('1.0.1-ext', '1.0.0')).toBe(false)
    expect(tagMatchesVersion('ext-v1.0.0', '1.0.0')).toBe(false)
  })
})

describe('真实版本号', () => {
  it('manifest 的版本号能直接产出三个 tag（发布闸门不会因预发布号炸掉）', () => {
    const tags = tagsForVersion(manifest.version)
    expect(tags).toHaveLength(3)
    for (const tag of tags) expect(parseVersionTag(tag)?.version).toBe(manifest.version)
  })
})
