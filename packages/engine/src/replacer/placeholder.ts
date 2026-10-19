import type { DetectionType } from '../types'

// 占位符命名规范（语义化中文：替换后 AI 仍能理解上下文）
// 格式：<<名称>> 或 <<名称:序号>>（同类多条时带序号）
const PLACEHOLDER_NAMES: Record<DetectionType, string> = {
  'ENV_PASSWORD': '密码',
  'API_KEY': 'API密钥',
  'DB_PASSWORD': '数据库密码',
  'JWT': 'JWT',
  'PRIVATE_KEY': '私钥',
  'HIGH_ENTROPY': '机密串',
  'EMAIL': '邮箱',
  'PHONE': '手机号',
  'ID_CARD': '身份证号',
  'BANK_CARD': '银行卡号',
  'IP_ADDRESS': 'IP地址',
  'PLATE': '车牌号',
  'NAME': '姓名',
  'ADDRESS': '地址'
}

// 反向映射（名称 → 类型），含旧英文格式别名（兼容历史映射表）
const NAME_TO_TYPE: Record<string, DetectionType> = {
  ...Object.fromEntries(
    Object.entries(PLACEHOLDER_NAMES).map(([type, name]) => [name, type as DetectionType])
  ),
  // 旧格式别名
  'SECRET': 'HIGH_ENTROPY',
  'ENV_PASSWORD': 'ENV_PASSWORD',
  'API_KEY': 'API_KEY',
  'DB_PASSWORD': 'DB_PASSWORD',
  'JWT': 'JWT',
  'PRIVATE_KEY': 'PRIVATE_KEY',
  'HIGH_ENTROPY': 'HIGH_ENTROPY',
  'EMAIL': 'EMAIL',
  'PHONE': 'PHONE'
}

// 生成占位符（首条不带序号，便于阅读）
export const generatePlaceholder = (
  type: DetectionType,
  index: number
): string => {
  const name = PLACEHOLDER_NAMES[type] || '机密串'
  return index > 1 ? `<<${name}:${index}>>` : `<<${name}>>`
}

// 解析占位符
export const parsePlaceholder = (placeholder: string): {
  type: DetectionType
  index: number
} | null => {
  const match = placeholder.match(/^<<([^:>]+)(?::(\d+))?>>$/)
  if (!match) return null

  const [, name, indexStr] = match
  const type = NAME_TO_TYPE[name]
  if (!type) return null

  return { type, index: indexStr ? parseInt(indexStr, 10) : 1 }
}

// 验证占位符格式
export const isValidPlaceholder = (str: string): boolean => {
  return /^<<[^:>]+(?::\d+)?>>$/.test(str)
}

// 获取占位符显示文本（占位符本身已是语义化中文，直接回显）
export const getPlaceholderDisplayText = (placeholder: string): string => {
  return placeholder
}

// 类型显示名（UI 复用，避免各组件重复维护映射）
export const getTypeDisplayName = (type: DetectionType): string =>
  PLACEHOLDER_NAMES[type] || type
