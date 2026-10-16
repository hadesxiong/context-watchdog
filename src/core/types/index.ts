// 检测项类型
export type DetectionType =
  | 'ENV_PASSWORD'
  | 'API_KEY'
  | 'DB_PASSWORD'
  | 'JWT'
  | 'PRIVATE_KEY'
  | 'HIGH_ENTROPY'
  | 'EMAIL'
  | 'PHONE'
  | 'ID_CARD'
  | 'BANK_CARD'
  | 'IP_ADDRESS'
  | 'PLATE'
  | 'NAME'
  | 'ADDRESS'

// 置信度类型
export type Confidence = 'high' | 'medium' | 'low'

// 检测来源
export type DetectionSource = 'model' | 'regex'

// 规则类别（Profile 按类别启用/停用规则集）
export type RuleCategory = 'secret' | 'pii' | 'entropy'

// 场景类型（启发式判定）
export type SceneType = 'yaml' | 'env' | 'code' | 'log' | 'json' | 'plain'

// 灵敏度档位（Profile 内每类别的阈值组合）
export type Sensitivity = 'loose' | 'standard' | 'strict'

// 检测配置档案
export interface ProfileConfig {
  id: string
  name: string
  description: string
  // 启用的规则类别
  enabledCategories: RuleCategory[]
  // 各类别灵敏度（未指定的类别用 standard）
  sensitivity: Partial<Record<RuleCategory, Sensitivity>>
  // 分类型默认替换策略（未指定的类型默认 replace）
  defaultActions: Partial<Record<DetectionType, 'replace' | 'keep'>>
  // 中低置信度是否降为"仅提示"（keep），高置信度仍替换
  tierLowConfidence: boolean
  // 送 GLiNER 的零样本实体标签
  glinerLabels: string[]
}

// 检测项
export interface DetectionItem {
  id: string
  type: DetectionType
  original: string
  placeholder: string
  startIndex: number
  endIndex: number
  confidence: Confidence
  context: string
  detectionTypes?: DetectionType[]  // 命中的所有检测类型
  source?: DetectionSource  // 检测来源
}

// 检测结果
export interface DetectionResult {
  items: DetectionItem[]
  text: string
}

// 替换操作
export type ReplaceAction = 'replace' | 'keep'

// 替换配置
export interface ReplaceConfig {
  itemId: string
  action: ReplaceAction
  customPlaceholder?: string
}

// 映射表
export interface MappingTable {
  [placeholder: string]: string
}

// 检测规则
export interface DetectionRule {
  type: DetectionType
  pattern: RegExp
  confidence: Confidence
  extractor?: (match: RegExpMatchArray, fullText: string) => { original: string; startIndex: number; endIndex: number } | null
}

// NER检测结果
export interface NERResult {
  entity_group: string
  word: string
  start: number
  end: number
  score: number
}
