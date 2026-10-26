import type { DetectionType } from '../types'

// 占位符命名规范（语义化：替换后 AI 仍能理解上下文）：<<名称>> 或 <<名称:序号>>（同类多条带序号）。
// 名称分语言，因为占位符会被真正写进用户复制去发给 AI 的文本——英文用户在英文界面下拿到
// `<<手机号>>` 是明显的破绽，所以名称表按 locale 分组，由宿主启动时用 setPlaceholderLocale()
// 声明（宿主才知道用户选了哪门语言）。默认 zh_CN：引擎不读浏览器 API、无法自行推断语言。
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
    'ADDRESS': '地址',
    'SSN': '社保号',
    'EIN': '税号',
    'IBAN': 'IBAN',
    'VAT': '增值税号'
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
    'ADDRESS': 'ADDRESS',
    'SSN': 'SSN',
    'EIN': 'EIN',
    'IBAN': 'IBAN',
    'VAT': 'VAT'
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

// 反向映射（名称 → 类型），含旧英文格式别名。收录**所有语言**的名称：映射表是持久化的，
// 用户切换语言后旧条目里的 <<手机号>> 仍要能被解析回 PHONE，否则「还原」会失败。
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

export const isValidPlaceholder = (str: string): boolean => {
  return /^<<[^:>]+(?::\d+)?>>$/.test(str)
}

// 占位符本身已是语义化名称，直接回显
export const getPlaceholderDisplayText = (placeholder: string): string => {
  return placeholder
}
