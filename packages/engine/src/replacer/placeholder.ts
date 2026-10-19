import type { DetectionType } from '../types'

// 占位符命名规范（语义化：替换后 AI 仍能理解上下文）
// 格式：<<名称>> 或 <<名称:序号>>（同类多条时带序号）
//
// 为什么名称要分语言：占位符会被真正写进用户复制去发给 AI 的文本里。
// 英文用户在英文界面下拿到 `<<手机号>>` 是明显的破绽，所以名称表按 locale 分组，
// 由宿主在启动时用 setPlaceholderLocale() 声明（宿主才知道用户选了哪门语言）。
//
// 默认 zh_CN：保持引擎既有行为不变（引擎自身不读任何浏览器 API，
// 因此无法自己推断语言，只能等宿主注入）。
export type PlaceholderLocale = 'zh_CN' | 'en'

const PLACEHOLDER_NAMES: Record<PlaceholderLocale, Record<DetectionType, string>> = {
  zh_CN: {
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
  },
  en: {
    'ENV_PASSWORD': 'PASSWORD',
    'API_KEY': 'API_KEY',
    'DB_PASSWORD': 'DB_PASSWORD',
    'JWT': 'JWT',
    'PRIVATE_KEY': 'PRIVATE_KEY',
    'HIGH_ENTROPY': 'SECRET',
    'EMAIL': 'EMAIL',
    'PHONE': 'PHONE',
    'ID_CARD': 'ID_CARD',
    'BANK_CARD': 'CARD_NUMBER',
    'IP_ADDRESS': 'IP',
    'PLATE': 'LICENSE_PLATE',
    'NAME': 'NAME',
    'ADDRESS': 'ADDRESS'
  }
}

/** 未知类型时的兜底名称（同样分语言，避免英文界面里蹦出中文） */
const FALLBACK_NAME: Record<PlaceholderLocale, string> = {
  zh_CN: '机密串',
  en: 'SECRET'
}

let activeLocale: PlaceholderLocale = 'zh_CN'

/** 由宿主声明占位符语言。引擎不读浏览器 API，语言只能从外部注入 */
export const setPlaceholderLocale = (locale: PlaceholderLocale): void => {
  activeLocale = locale
}

export const getPlaceholderLocale = (): PlaceholderLocale => activeLocale

// 反向映射（名称 → 类型），含旧英文格式别名（兼容历史映射表）
//
// 关键：这里收录**所有语言**的名称。映射表是持久化的，用户切换语言后
// 旧条目里的 <<手机号>> 仍要能被解析回 PHONE，否则「还原」会失败。
const NAME_TO_TYPE: Record<string, DetectionType> = {
  ...Object.fromEntries(
    Object.values(PLACEHOLDER_NAMES).flatMap((names) =>
      Object.entries(names).map(([type, name]) => [name, type as DetectionType])
    )
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
  const name = PLACEHOLDER_NAMES[activeLocale][type] || FALLBACK_NAME[activeLocale]
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

// 获取占位符显示文本（占位符本身已是语义化名称，直接回显）
export const getPlaceholderDisplayText = (placeholder: string): string => {
  return placeholder
}
