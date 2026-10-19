// 单元用例 - 档案 JSON 导入导出（Phase 5）
import { describe, it, expect } from 'vitest'
import {
  UserProfileManager,
  exportProfiles,
  importProfiles,
  type KeyValueStorage
} from '@engine/detector/userProfiles'
import { getProfileById } from '@engine/detector/profiles'
import type { ProfileConfig, CustomRule } from '@engine/types'

const createMockStorage = () => {
  const data: Record<string, unknown> = {}
  const storage: KeyValueStorage = {
    get: async key => ({ [key]: data[key] }),
    set: async items => Object.assign(data, items)
  }
  return { storage, data }
}

const customRule: CustomRule = {
  id: 'rule-1',
  name: '工号规则',
  pattern: 'EMP-\\d{6}',
  type: 'ID_CARD',
  confidence: 'high',
  enabled: true
}

const userProfile: ProfileConfig = {
  ...structuredClone(getProfileById('text')),
  id: 'user-export-1',
  name: '导出测试',
  builtin: false,
  whitelist: ['example.com'],
  customRules: [customRule]
}

describe('exportProfiles', () => {
  it('只导出用户档案，内置档案排除', () => {
    const json = exportProfiles([getProfileById('universal'), userProfile])
    const payload = JSON.parse(json)

    expect(payload.version).toBe(1)
    expect(payload.profiles).toHaveLength(1)
    expect(payload.profiles[0].id).toBe('user-export-1')
    expect(payload.profiles[0].customRules).toHaveLength(1)
  })

  it('空列表导出合法 JSON', () => {
    const payload = JSON.parse(exportProfiles([]))
    expect(payload.profiles).toHaveLength(0)
  })
})

describe('importProfiles', () => {
  it('往返一致：导出再导入保留全部配置', () => {
    const json = exportProfiles([userProfile])
    const [imported] = importProfiles(json)

    expect(imported.name).toBe('导出测试')
    expect(imported.whitelist).toEqual(['example.com'])
    expect(imported.customRules).toEqual([customRule])
    expect(imported.sensitivity).toEqual(userProfile.sensitivity)
    expect(imported.defaultActions).toEqual(userProfile.defaultActions)
    // id 重新生成防碰撞
    expect(imported.id).toMatch(/^user-/)
    expect(imported.id).not.toBe('user-export-1')
  })

  it('拒绝坏输入', () => {
    expect(() => importProfiles('not json')).toThrow('JSON 解析失败')
    expect(() => importProfiles('null')).toThrow('不是有效')
    expect(() => importProfiles('{"version":99,"profiles":[{}]}')).toThrow('版本')
    expect(() => importProfiles('{"version":1,"profiles":[]}')).toThrow('没有档案数据')
    expect(() => importProfiles('{"version":1,"profiles":[{"bad":true}]}')).toThrow('合法档案')
  })

  it('导入时过滤危险正则（ReDoS 防线在导入路径同样生效）', () => {
    const evil = {
      version: 1,
      profiles: [{
        id: 'user-x',
        name: '恶意档案',
        customRules: [
          { id: 'r1', name: 'evil', pattern: '(a+)+', type: 'HIGH_ENTROPY', confidence: 'high', enabled: true },
          { id: 'r2', name: 'good', pattern: 'EMP-\\d{6}', type: 'ID_CARD', confidence: 'high', enabled: true }
        ]
      }]
    }
    const [imported] = importProfiles(JSON.stringify(evil))
    expect(imported.customRules).toHaveLength(1)
    expect(imported.customRules[0].pattern).toBe('EMP-\\d{6}')
  })

  it('超量档案拒绝', () => {
    const bulk = {
      version: 1,
      profiles: Array.from({ length: 51 }, (_, i) => ({ id: `user-${i}`, name: `p${i}` }))
    }
    expect(() => importProfiles(JSON.stringify(bulk))).toThrow('50')
  })
})

describe('Manager.importFromJson', () => {
  it('重名自动加序号，持久化生效', async () => {
    const { storage } = createMockStorage()
    const mgr = new UserProfileManager(storage)
    await mgr.load()

    // 先建一个同名档案
    await mgr.create(getProfileById('universal'), '导出测试')

    const json = exportProfiles([userProfile])
    const imported = await mgr.importFromJson(json)

    expect(imported).toHaveLength(1)
    expect(imported[0].name).toBe('导出测试 2')

    // 再导入一次 → 序号递增
    const imported2 = await mgr.importFromJson(json)
    expect(imported2[0].name).toBe('导出测试 3')

    // 持久化：新 manager 恢复
    const mgr2 = new UserProfileManager(storage)
    await mgr2.load()
    expect(mgr2.getAll().filter(p => !p.builtin)).toHaveLength(3)
  })

  it('Manager 导出-导入全链路往返', async () => {
    const { storage } = createMockStorage()
    const mgr = new UserProfileManager(storage)
    await mgr.load()
    const created = await mgr.create(getProfileById('code'), '链路测试')
    await mgr.update({ ...created, whitelist: ['corp.com'], customRules: [customRule] })

    // 导出
    const json = mgr.exportJson()
    expect(JSON.parse(json).profiles[0].customRules).toHaveLength(1)

    // 导入到全新环境
    const { storage: storage2 } = createMockStorage()
    const mgr2 = new UserProfileManager(storage2)
    await mgr2.load()
    const imported = await mgr2.importFromJson(json)

    expect(imported[0].whitelist).toEqual(['corp.com'])
    expect(imported[0].customRules).toEqual([customRule])

    // 新环境持久化往返
    const mgr3 = new UserProfileManager(storage2)
    await mgr3.load()
    expect(mgr3.getAll().find(p => p.name === imported[0].name)?.customRules).toEqual([customRule])
  })
})
