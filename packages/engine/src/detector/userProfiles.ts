// 用户自定义 Profile 管理：内置档案不可改删，用户档案可 CRUD、持久化于 chrome.storage.local；存储接口可注入（测试用 mock）。

import type { ProfileConfig, RuleCategory, Sensitivity, DetectionType, CustomRule } from '../types'
import { BUILTIN_PROFILES } from './profiles'
import { validateCustomPattern } from './rules/customRules'
import { generateId } from '../utils/id'

export const USER_PROFILES_KEY = 'contextwatchdog.userProfiles'

export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

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

const RULE_CATEGORIES: RuleCategory[] = ['secret', 'pii', 'entropy', 'us', 'eu']
const SENSITIVITIES: Sensitivity[] = ['loose', 'standard', 'strict']

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
    customRules: sanitizeCustomRules(p.customRules)
  }
}

const CUSTOM_RULE_TYPES: DetectionType[] = [
  'ENV_PASSWORD', 'API_KEY', 'DB_PASSWORD', 'JWT', 'PRIVATE_KEY', 'HIGH_ENTROPY',
  'EMAIL', 'PHONE', 'ID_CARD', 'BANK_CARD', 'IP_ADDRESS', 'PLATE', 'NAME', 'ADDRESS'
]

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

export const validateProfileName = (
  name: string,
  existing: ProfileConfig[]
): string | null => {
  if (!name.trim()) return '名称不能为空'
  if (name.trim().length > 20) return '名称不能超过 20 字符'
  if (existing.some(p => p.name === name.trim())) return '名称与现有档案重复'
  return null
}

const EXPORT_VERSION = 1

export interface ProfileExportPayload {
  version: number
  exportedAt: string
  profiles: ProfileConfig[]
}

export const exportProfiles = (profiles: ProfileConfig[]): string => {
  const payload: ProfileExportPayload = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profiles: profiles.filter(p => !p.builtin)
  }
  return JSON.stringify(payload, null, 2)
}

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

export class UserProfileManager {
  private userProfiles: ProfileConfig[] = []

  constructor(private storage: KeyValueStorage | null) {}

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
      console.warn('[ContextWatchdog] Failed to load user profiles:', error)
      this.userProfiles = []
    }
  }

  private async persist(): Promise<void> {
    if (!this.storage) return
    try {
      await this.storage.set({ [USER_PROFILES_KEY]: this.userProfiles })
    } catch (error) {
      console.warn('[ContextWatchdog] Failed to persist user profiles:', error)
    }
  }

  getAll(): ProfileConfig[] {
    return [...BUILTIN_PROFILES, ...this.userProfiles]
  }

  get(id: string): ProfileConfig | null {
    return this.getAll().find(p => p.id === id) || null
  }

  isUserOwned(id: string): boolean {
    return this.userProfiles.some(p => p.id === id)
  }

  async create(base: ProfileConfig, name: string): Promise<ProfileConfig> {
    const error = validateProfileName(name, this.getAll())
    if (error) throw new Error(error)

    const profile = cloneProfile(base, name)
    this.userProfiles.push(profile)
    await this.persist()
    return profile
  }

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

  async remove(id: string): Promise<void> {
    const idx = this.userProfiles.findIndex(p => p.id === id)
    if (idx === -1) throw new Error('只能删除自定义档案')
    this.userProfiles.splice(idx, 1)
    await this.persist()
  }

  exportJson(): string {
    return exportProfiles(this.userProfiles)
  }

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
    console.log('[ContextWatchdog] Imported', imported.length, 'user profiles')
    return this.userProfiles.slice(-imported.length)
  }
}
