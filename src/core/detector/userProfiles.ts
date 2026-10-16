// 用户自定义 Profile 管理（Phase 4 轻量自定义）
// - 内置档案不可改删；用户档案可 CRUD，持久化于 chrome.storage.local
// - 存储接口可注入（测试用 mock）

import type { ProfileConfig, RuleCategory, Sensitivity, DetectionType, CustomRule } from '../types'
import { BUILTIN_PROFILES } from './profiles'
import { validateCustomPattern } from './rules/customRules'
import { generateId } from '../utils/id'

export const USER_PROFILES_KEY = 'pasteguard.userProfiles'

// 可注入的 KV 存储接口
export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

// chrome.storage.local 适配器（浏览器环境）
export const createChromeStorage = (): KeyValueStorage | null => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
  return {
    get: key =>
      new Promise(resolve => {
        chrome.storage.local.get(key, result => resolve(result as Record<string, unknown>))
      }),
    set: items =>
      new Promise(resolve => chrome.storage.local.set(items, () => resolve()))
  }
}

const RULE_CATEGORIES: RuleCategory[] = ['secret', 'pii', 'entropy']
const SENSITIVITIES: Sensitivity[] = ['loose', 'standard', 'strict']

// 深拷贝并规范化档案（防御存储数据损坏 / 版本漂移）
export const sanitizeProfile = (raw: unknown): ProfileConfig | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>

  if (typeof p.id !== 'string' || !p.id.startsWith('user-')) return null
  if (typeof p.name !== 'string' || p.name.trim() === '') return null

  return {
    id: p.id,
    name: p.name.trim().slice(0, 20),
    description: typeof p.description === 'string' ? p.description.slice(0, 100) : '',
    builtin: false,
    enabledCategories: Array.isArray(p.enabledCategories)
      ? p.enabledCategories.filter((c): c is RuleCategory => RULE_CATEGORIES.includes(c as RuleCategory))
      : ['secret', 'pii', 'entropy'],
    sensitivity: (typeof p.sensitivity === 'object' && p.sensitivity !== null
      ? Object.fromEntries(
          Object.entries(p.sensitivity as Record<string, unknown>).filter(
            ([, v]) => SENSITIVITIES.includes(v as Sensitivity)
          )
        )
      : {}) as Partial<Record<RuleCategory, Sensitivity>>,
    defaultActions: (typeof p.defaultActions === 'object' && p.defaultActions !== null
      ? Object.fromEntries(
          Object.entries(p.defaultActions as Record<string, unknown>).filter(
            ([, v]) => v === 'replace' || v === 'keep'
          )
        )
      : {}) as Partial<Record<DetectionType, 'replace' | 'keep'>>,
    tierLowConfidence: p.tierLowConfidence !== false,
    glinerLabels: Array.isArray(p.glinerLabels)
      ? p.glinerLabels.filter((l): l is string => typeof l === 'string').slice(0, 30)
      : [],
    whitelist: Array.isArray(p.whitelist)
      ? p.whitelist.filter((w): w is string => typeof w === 'string' && w.trim() !== '').slice(0, 200)
      : [],
    // 自定义规则：逐条过 ReDoS 校验，非法模式丢弃而非拒绝整个档案
    customRules: sanitizeCustomRules(p.customRules)
  }
}

const CUSTOM_RULE_TYPES: DetectionType[] = [
  'ENV_PASSWORD', 'API_KEY', 'DB_PASSWORD', 'JWT', 'PRIVATE_KEY', 'HIGH_ENTROPY',
  'EMAIL', 'PHONE', 'ID_CARD', 'BANK_CARD', 'IP_ADDRESS', 'PLATE', 'NAME', 'ADDRESS'
]

// 自定义规则数组清洗（导入/存储共用）
export const sanitizeCustomRules = (raw: unknown): CustomRule[] => {
  if (!Array.isArray(raw)) return []
  const result: CustomRule[] = []
  const seenPatterns = new Set<string>()

  for (const item of raw) {
    if (typeof item !== 'object' || item === null || result.length >= 50) continue
    const r = item as Record<string, unknown>
    if (typeof r.name !== 'string' || typeof r.pattern !== 'string') continue
    if (!CUSTOM_RULE_TYPES.includes(r.type as DetectionType)) continue

    const pattern = r.pattern.trim()
    // ReDoS 校验：非法/危险模式静默丢弃
    if (!validateCustomPattern(pattern).ok) continue
    if (seenPatterns.has(pattern)) continue
    seenPatterns.add(pattern)

    result.push({
      id: typeof r.id === 'string' && r.id ? r.id : `rule-${generateId()}`,
      name: r.name.trim().slice(0, 20) || '未命名规则',
      pattern,
      type: r.type as DetectionType,
      confidence: r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : 'high',
      enabled: r.enabled !== false
    })
  }
  return result
}

// 从模板克隆生成新用户档案（Phase 4 主要创建路径："基于当前档案新建"）
export const cloneProfile = (base: ProfileConfig, name: string): ProfileConfig => ({
  id: `user-${generateId()}`,
  name: name.trim().slice(0, 20),
  description: `基于「${base.name}」的自定义档案`,
  builtin: false,
  enabledCategories: [...base.enabledCategories],
  sensitivity: { ...base.sensitivity },
  defaultActions: { ...base.defaultActions },
  tierLowConfidence: base.tierLowConfidence,
  glinerLabels: [...base.glinerLabels],
  whitelist: [...(base.whitelist || [])],
  customRules: (base.customRules || []).map(r => ({ ...r }))
})

// 名称校验：非空、不与现有档案重名
export const validateProfileName = (
  name: string,
  existing: ProfileConfig[]
): string | null => {
  if (!name.trim()) return '名称不能为空'
  if (name.trim().length > 20) return '名称不能超过 20 字符'
  if (existing.some(p => p.name === name.trim())) return '名称与现有档案重复'
  return null
}

// ---- JSON 导入导出（Phase 5） ----

const EXPORT_VERSION = 1

export interface ProfileExportPayload {
  version: number
  exportedAt: string
  profiles: ProfileConfig[]
}

// 导出用户档案为 JSON（内置档案不导出；导入到新环境后仍是自定义档案）
export const exportProfiles = (profiles: ProfileConfig[]): string => {
  const payload: ProfileExportPayload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profiles: profiles.filter(p => !p.builtin)
  }
  return JSON.stringify(payload, null, 2)
}

// 导入：解析 + 校验 + 重新生成 id（防与现有档案 id 碰撞）
// 名称去重在 Manager 层做（需要现有档案名单）
export const importProfiles = (json: string): ProfileConfig[] => {
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    throw new Error('JSON 解析失败，请检查内容格式')
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('内容不是有效的档案 JSON')
  }
  const p = payload as Record<string, unknown>
  if (p.version !== EXPORT_VERSION) {
    throw new Error(`不支持的导出版本：${String(p.version)}（当前支持 v${EXPORT_VERSION}）`)
  }
  if (!Array.isArray(p.profiles) || p.profiles.length === 0) {
    throw new Error('JSON 中没有档案数据')
  }
  if (p.profiles.length > 50) {
    throw new Error('单次导入不能超过 50 个档案')
  }

  const imported = p.profiles
    .map(sanitizeProfile)
    .filter((x): x is ProfileConfig => x !== null)
  if (imported.length === 0) {
    throw new Error('没有可导入的合法档案（数据格式不合规）')
  }

  return imported.map(profile => ({ ...profile, id: `user-${generateId()}` }))
}

// 用户 Profile 管理器
export class UserProfileManager {
  private userProfiles: ProfileConfig[] = []

  constructor(private storage: KeyValueStorage | null) {}

  // 从存储加载（存储不可用时静默为空）
  async load(): Promise<void> {
    if (!this.storage) return
    try {
      const result = await this.storage.get(USER_PROFILES_KEY)
      const raw = result?.[USER_PROFILES_KEY]
      if (Array.isArray(raw)) {
        this.userProfiles = raw
          .map(sanitizeProfile)
          .filter((p): p is ProfileConfig => p !== null)
      }
    } catch (error) {
      console.warn('[PasteGuard] Failed to load user profiles:', error)
      this.userProfiles = []
    }
  }

  private async persist(): Promise<void> {
    if (!this.storage) return
    try {
      await this.storage.set({ [USER_PROFILES_KEY]: this.userProfiles })
    } catch (error) {
      console.warn('[PasteGuard] Failed to persist user profiles:', error)
    }
  }

  // 全部档案（内置 + 用户）
  getAll(): ProfileConfig[] {
    return [...BUILTIN_PROFILES, ...this.userProfiles]
  }

  get(id: string): ProfileConfig | null {
    return this.getAll().find(p => p.id === id) || null
  }

  isUserOwned(id: string): boolean {
    return this.userProfiles.some(p => p.id === id)
  }

  // 新建：从任意档案（含内置）克隆
  async create(base: ProfileConfig, name: string): Promise<ProfileConfig> {
    const error = validateProfileName(name, this.getAll())
    if (error) throw new Error(error)

    const profile = cloneProfile(base, name)
    this.userProfiles.push(profile)
    await this.persist()
    return profile
  }

  // 更新（仅用户档案；id 不可变）
  async update(profile: ProfileConfig): Promise<ProfileConfig> {
    const idx = this.userProfiles.findIndex(p => p.id === profile.id)
    if (idx === -1) throw new Error('只能修改自定义档案')

    const nameError = validateProfileName(
      profile.name,
      this.getAll().filter(p => p.id !== profile.id)
    )
    if (nameError) throw new Error(nameError)

    const sanitized = sanitizeProfile({ ...profile, id: profile.id, builtin: false })
    if (!sanitized) throw new Error('档案数据不合法')

    this.userProfiles[idx] = sanitized
    await this.persist()
    return sanitized
  }

  // 删除（仅用户档案）
  async remove(id: string): Promise<void> {
    const idx = this.userProfiles.findIndex(p => p.id === id)
    if (idx === -1) throw new Error('只能删除自定义档案')
    this.userProfiles.splice(idx, 1)
    await this.persist()
  }

  // 导出全部用户档案为 JSON
  exportJson(): string {
    return exportProfiles(this.userProfiles)
  }

  // 从 JSON 导入：id 重生成防碰撞，重名自动加序号
  async importFromJson(json: string): Promise<ProfileConfig[]> {
    const imported = importProfiles(json)
    const existingNames = new Set(this.getAll().map(p => p.name))

    for (const profile of imported) {
      let name = profile.name
      let n = 2
      while (existingNames.has(name)) {
        name = `${profile.name.slice(0, 16)} ${n++}`
      }
      existingNames.add(name)
      this.userProfiles.push({ ...profile, name })
    }

    await this.persist()
    console.log('[PasteGuard] Imported', imported.length, 'user profiles')
    return this.userProfiles.slice(-imported.length)
  }
}
