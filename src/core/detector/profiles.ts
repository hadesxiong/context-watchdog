// Profile 注册表 - 内置检测配置档案
// 新增场景 = 新增一个 ProfileConfig 配置项，无新代码路径

import type { ProfileConfig, Sensitivity, RuleCategory } from '../types'

// GLiNER 标签集
const PII_LABELS = [
  'person name',
  'phone number',
  'home address',
  'email address',
  'ID card number',
  'bank card number'
]

const SECRET_LABELS = [
  'password',
  'secret',
  'api key',
  'access token',
  'private key',
  'connection string'
]

const ALL_LABELS = [...PII_LABELS, ...SECRET_LABELS]

// 内置 Profile：通用文本 / 代码开发 / 不限（默认，仲裁合成）
export const BUILTIN_PROFILES: ProfileConfig[] = [
  {
    id: 'universal',
    name: '不限',
    description: '全规则并集 + 仲裁：凭据类直接替换，中低置信度仅提示',
    enabledCategories: ['secret', 'pii', 'entropy'],
    sensitivity: { entropy: 'standard' },
    defaultActions: { EMAIL: 'keep', HIGH_ENTROPY: 'keep', IP_ADDRESS: 'keep' },
    tierLowConfidence: true,
    glinerLabels: ALL_LABELS
  },
  {
    id: 'text',
    name: '通用文本',
    description: 'PII 检测为主，高熵收紧，适合聊天、文档、工单',
    enabledCategories: ['secret', 'pii', 'entropy'],
    sensitivity: { entropy: 'strict' },
    defaultActions: { EMAIL: 'keep', HIGH_ENTROPY: 'keep', IP_ADDRESS: 'keep' },
    tierLowConfidence: true,
    glinerLabels: PII_LABELS
  },
  {
    id: 'code',
    name: '代码开发',
    description: '密钥检测全开，高熵放宽，PII 仅提示，适合配置与代码',
    enabledCategories: ['secret', 'pii', 'entropy'],
    sensitivity: { entropy: 'loose' },
    defaultActions: {
      EMAIL: 'keep',
      PHONE: 'keep',
      ID_CARD: 'keep',
      BANK_CARD: 'keep',
      IP_ADDRESS: 'keep',
      PLATE: 'keep'
    },
    tierLowConfidence: false,
    glinerLabels: SECRET_LABELS
  }
]

export const DEFAULT_PROFILE_ID = 'universal'

export const getProfileById = (id: string): ProfileConfig =>
  BUILTIN_PROFILES.find(p => p.id === id) || BUILTIN_PROFILES[0]

// 类别灵敏度（未配置时用 standard）
export const getSensitivity = (profile: ProfileConfig, category: RuleCategory): Sensitivity =>
  profile.sensitivity[category] || 'standard'

// 高熵检测阈值档位
export const ENTROPY_THRESHOLDS: Record<Sensitivity, { minLength: number; minEntropy: number }> = {
  loose: { minLength: 20, minEntropy: 3.0 },
  standard: { minLength: 25, minEntropy: 3.5 },
  strict: { minLength: 30, minEntropy: 4.0 }
}
