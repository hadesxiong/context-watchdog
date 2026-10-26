// Profile 注册表：新增场景 = 新增一个 ProfileConfig 配置项，无新代码路径

import type { ProfileConfig, Sensitivity, RuleCategory, DetectionType, Confidence } from '../types'

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

export const BUILTIN_PROFILES: ProfileConfig[] = [
  {
    id: 'universal',
    name: '不限',
    description: '全规则并集 + 仲裁：凭据类直接替换，中低置信度仅提示',
    builtin: true,
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
    builtin: true,
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
    builtin: true,
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
  },
  // 区域档案：tierLowConfidence: false —— 用户显式选了区域档案，就是希望检出的都替换掉
  {
    id: 'us',
    name: '美国个人信息',
    description: '在通用规则之外追加美国社保号 / 税号 / 电话（含号段校验）',
    builtin: true,
    enabledCategories: ['secret', 'pii', 'entropy', 'us'],
    sensitivity: { entropy: 'standard' },
    defaultActions: { EMAIL: 'keep', HIGH_ENTROPY: 'keep', IP_ADDRESS: 'keep' },
    tierLowConfidence: false,
    glinerLabels: ALL_LABELS
  },
  {
    id: 'eu',
    name: '欧盟个人信息',
    description: '在通用规则之外追加 IBAN（mod-97 校验）与增值税号',
    builtin: true,
    enabledCategories: ['secret', 'pii', 'entropy', 'eu'],
    sensitivity: { entropy: 'standard' },
    defaultActions: { EMAIL: 'keep', HIGH_ENTROPY: 'keep', IP_ADDRESS: 'keep' },
    tierLowConfidence: false,
    glinerLabels: ALL_LABELS
  }
]

export const DEFAULT_PROFILE_ID = 'universal'

export const getProfileById = (id: string): ProfileConfig =>
  BUILTIN_PROFILES.find(p => p.id === id) || BUILTIN_PROFILES[0]

export const getSensitivity = (profile: ProfileConfig, category: RuleCategory): Sensitivity =>
  profile.sensitivity[category] || 'standard'

export const ENTROPY_THRESHOLDS: Record<Sensitivity, { minLength: number; minEntropy: number }> = {
  loose: { minLength: 20, minEntropy: 3.0 },
  standard: { minLength: 25, minEntropy: 3.5 },
  strict: { minLength: 30, minEntropy: 4.0 }
}

// 默认替换动作的唯一权威来源（显式配置 > 置信度分层 > 替换）：侧栏、粘贴正则首答、AI 二次升级三条链路都必须用它，否则会出现「判定为保留、却仍被脱敏」的策略漂移。
export const resolveDefaultAction = (
  profile: ProfileConfig,
  type: DetectionType,
  confidence: Confidence
): 'replace' | 'keep' => {
  const explicit = profile.defaultActions[type]
  if (explicit) return explicit
  // tierLowConfidence：中低置信度降为仅提示（keep）
  if (profile.tierLowConfidence && confidence !== 'high') return 'keep'
  return 'replace'
}
