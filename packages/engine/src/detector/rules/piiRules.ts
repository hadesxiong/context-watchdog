// PII 规则集 - 通用文本个人敏感信息检测
// 全部纯正则 + 算法校验（身份证校验位 / 银行卡 Luhn），控制误报
// 默认策略：手机号/身份证/银行卡/IP/车牌 → 替换；邮箱 → 保留（见 emailRules.ts）

import type { DetectionRule } from '../../types'

// ============ 校验算法 ============

// 身份证 ISO 7064 校验位验证（18位）
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

export const isValidCNIdCard = (id: string): boolean => {
  if (!/^\d{17}[\dXx]$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += parseInt(id[i], 10) * ID_WEIGHTS[i]
  }
  return ID_CHECK_CODES[sum % 11] === id[17].toUpperCase()
}

// 银行卡 Luhn 校验
export const isValidLuhn = (num: string): boolean => {
  if (!/^\d{13,19}$/.test(num)) return false
  let sum = 0
  let alt = false
  for (let i = num.length - 1; i >= 0; i--) {
    let d = parseInt(num[i], 10)
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

// ============ 规则 ============

export const piiRules: DetectionRule[] = [
  // 身份证号（18位 + 校验位验证，medium 置信度起步但校验通过极可靠）
  {
    type: 'ID_CARD',
    pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    confidence: 'high',
    extractor: (match) => {
      const id = match[0]
      if (!isValidCNIdCard(id)) return null
      return {
        original: id,
        startIndex: match.index!,
        endIndex: match.index! + id.length
      }
    }
  },
  // 银行卡号（13-19位 + Luhn 校验）
  {
    type: 'BANK_CARD',
    pattern: /(?<!\d)\d{13,19}(?!\d)/g,
    confidence: 'high',
    extractor: (match) => {
      const num = match[0]
      if (!isValidLuhn(num)) return null
      return {
        original: num,
        startIndex: match.index!,
        endIndex: match.index! + num.length
      }
    }
  },
  // 中国大陆手机号（含 +86 前缀和分隔符格式）
  {
    type: 'PHONE',
    pattern: /(?:\+?86[-\s]?)?(?<!\d)1[3-9]\d{9}(?!\d)/g,
    confidence: 'high'
  },
  // 座机号（010-12345678 / 0755-12345678 格式）
  {
    type: 'PHONE',
    pattern: /(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?!\d)/g,
    confidence: 'medium'
  },
  // IPv4 地址（作为 PII 弱信号，Profile 决定是否默认替换）
  {
    type: 'IP_ADDRESS',
    pattern: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g,
    confidence: 'medium'
  },
  // 中国车牌号（省份汉字 + 字母 + 5-6位）
  {
    type: 'PLATE',
    pattern: /[京津冀晋蒙辽吉黑沪苏浙皖闽赣鲁豫鄂湘粤桂琼渝川贵云藏陕甘青宁新][A-Z][A-Z0-9]{5,6}/g,
    confidence: 'medium'
  }
]
