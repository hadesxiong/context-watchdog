// 单元用例 - 用户自定义档案 CRUD（Phase 4）
import { describe, it, expect } from 'vitest'
import {
  UserProfileManager,
  cloneProfile,
  sanitizeProfile,
  validateProfileName,
  USER_PROFILES_KEY,
  type KeyValueStorage
} from '@engine/detector/userProfiles'
import { BUILTIN_PROFILES, getProfileById } from '@engine/detector/profiles'

// 内存 mock 存储
const createMockStorage = () => {
  const data: Record<string, unknown> = {}
  const storage: KeyValueStorage = {
    get: async key => ({ [key]: data[key] }),
    set: async items => Object.assign(data, items)
  }
  return { storage, data }
}

describe('cloneProfile', () => {
  it('从内置档案克隆：深拷贝、新 id、非内置、保留配置', () => {
    const base = getProfileById('code')
    const clone = cloneProfile(base, '我的开发档案')

    expect(clone.id).toMatch(/^user-/)
    expect(clone.id).not.toBe(base.id)
    expect(clone.builtin).toBe(false)
    expect(clone.name).toBe('我的开发档案')
    expect(clone.enabledCategories).toEqual(base.enabledCategories)
    expect(clone.sensitivity).toEqual(base.sensitivity)
    expect(clone.glinerLabels).toEqual(base.glinerLabels)

    // 深拷贝：改 clone 不影响 base
    clone.sensitivity.entropy = 'strict'
    clone.glinerLabels.push('x')
    expect(getProfileById('code').sensitivity.entropy).toBe('loose')
    expect(getProfileById('code').glinerLabels).not.toContain('x')
  })
})

describe('sanitizeProfile', () => {
  it('拒绝非法数据', () => {
    expect(sanitizeProfile(null)).toBeNull()
    expect(sanitizeProfile('str')).toBeNull()
    expect(sanitizeProfile({ id: 'builtin-x', name: 'x' })).toBeNull() // 非 user- 前缀
    expect(sanitizeProfile({ id: 'user-1', name: '' })).toBeNull()
  })

  it('规范化损坏数据：非法枚举剔除、超长截断', () => {
    const p = sanitizeProfile({
      id: 'user-1',
      name: '测试'.repeat(50), // 超长
      enabledCategories: ['secret', 'badcat', 'pii'],
      sensitivity: { entropy: 'invalid', pii: 'strict' },
      defaultActions: { EMAIL: 'keep', PHONE: 'bogus' },
      glinerLabels: ['ok', 123, null],
      whitelist: ['a', '  ', 42]
    })!
    expect(p).not.toBeNull()
    expect(p.name.length).toBe(20)
    expect(p.enabledCategories).toEqual(['secret', 'pii'])
    expect(p.sensitivity).toEqual({ pii: 'strict' })
    expect(p.defaultActions).toEqual({ EMAIL: 'keep' })
    expect(p.glinerLabels).toEqual(['ok'])
    expect(p.whitelist).toEqual(['a'])
  })
})

describe('validateProfileName', () => {
  it('空/超长/重名校验', () => {
    const existing = BUILTIN_PROFILES
    expect(validateProfileName('', existing)).not.toBeNull()
    expect(validateProfileName('   ', existing)).not.toBeNull()
    expect(validateProfileName('很长的名字'.repeat(10), existing)).not.toBeNull()
    expect(validateProfileName('不限', existing)).toBe('名称与现有档案重复')
    expect(validateProfileName('我的档案', existing)).toBeNull()
  })
})

describe('UserProfileManager', () => {
  it('CRUD 全流程 + 持久化往返', async () => {
    const { storage, data } = createMockStorage()
    const mgr = new UserProfileManager(storage)
    await mgr.load()

    // 创建
    const base = getProfileById('text')
    const created = await mgr.create(base, '工单专用')
    expect(mgr.getAll()).toHaveLength(BUILTIN_PROFILES.length + 1)
    expect(mgr.isUserOwned(created.id)).toBe(true)
    expect(data[USER_PROFILES_KEY]).toHaveLength(1)

    // 重名拒绝
    await expect(mgr.create(base, '工单专用')).rejects.toThrow('重复')

    // 更新
    const updated = await mgr.update({
      ...created,
      name: '客服工单',
      whitelist: ['example.com'],
      enabledCategories: ['pii']
    })
    expect(updated.name).toBe('客服工单')
    expect(mgr.get(created.id)?.whitelist).toEqual(['example.com'])

    // 新 manager 实例从同一存储恢复（持久化验证）
    const mgr2 = new UserProfileManager(storage)
    await mgr2.load()
    expect(mgr2.get(created.id)?.name).toBe('客服工单')
    expect(mgr2.get(created.id)?.enabledCategories).toEqual(['pii'])

    // 删除
    await mgr2.remove(created.id)
    expect(mgr2.isUserOwned(created.id)).toBe(false)

    const mgr3 = new UserProfileManager(storage)
    await mgr3.load()
    expect(mgr3.get(created.id)).toBeNull()
  })

  it('内置档案不可改删', async () => {
    const { storage } = createMockStorage()
    const mgr = new UserProfileManager(storage)
    await mgr.load()

    await expect(mgr.update({ ...getProfileById('code'), name: 'x' })).rejects.toThrow('自定义')
    await expect(mgr.remove('code')).rejects.toThrow('自定义')
  })

  it('存储损坏数据不崩溃（sanitize 过滤）', async () => {
    const { storage, data } = createMockStorage()
    data[USER_PROFILES_KEY] = [null, 'junk', { id: 'user-ok', name: '好档案' }, { bad: true }]
    const mgr = new UserProfileManager(storage)
    await mgr.load()
    expect(mgr.getAll()).toHaveLength(BUILTIN_PROFILES.length + 1)
  })

  it('存储不可用时静默降级', async () => {
    const mgr = new UserProfileManager(null)
    await mgr.load()
    expect(mgr.getAll()).toHaveLength(BUILTIN_PROFILES.length)
    // 内存操作仍可用（不持久化）
    const p = await mgr.create(getProfileById('universal'), '临时档案')
    expect(mgr.get(p.id)).not.toBeNull()
  })
})
