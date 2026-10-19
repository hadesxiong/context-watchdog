// 美国区域规则集（Profile 按 'us' 类别启用）
//
// 与通用 PII 规则的分工：这里的模式**只在美国语境下成立**，
// 放进通用集会给其他地区的用户带来误报（例如 123-45-6789 这种
// `\d{3}-\d{2}-\d{4}` 形状在别处也很常见），因此单独成集。
//
// 三条规则都带算法/号段校验——不加校验的话误报率会高到不可用：
//   SSN   写进正则里太宽松，必须排除 SSA 从不签发的号段
//   EIN   裸 `\d{2}-\d{7}` 在文本里遍地都是，因此要求带标签
//   电话  NANP 的区号/局号首位不能是 0/1，这一条能挡掉绝大多数日期与编号

import type { DetectionRule } from '../../types'

// ============ 校验算法 ============

/**
 * SSN（AAA-GG-SSSS）。
 * 排除 SSA 从未签发的号段：
 *   · 区号 000 / 666 / 900-999
 *   · 组号 00
 *   · 序号 0000
 *   · 三段全为同一数字（111-11-1111 之类，从未签发）
 */
export const isValidUSSSN = (ssn: string): boolean => {
  const match = ssn.match(/^(\d{3})-(\d{2})-(\d{4})$/)
  if (!match) return false
  const [, area, group, serial] = match
  if (area === '000' || area === '666') return false
  if (area[0] === '9') return false
  if (group === '00') return false
  if (serial === '0000') return false
  if (/^(\d)\1{2}-\1{2}-\1{4}$/.test(ssn)) return false
  return true
}

// EIN 的合法前缀（IRS 各服务中分配过的号段，00/07/08/09/17/18/19/28/29/49/69/79/89 等从未分配）
const EIN_PREFIXES = new Set([
  '01', '02', '03', '04', '05', '06', '10', '11', '12', '13', '14', '15', '16',
  '20', '21', '22', '23', '24', '25', '26', '27', '30', '31', '32', '33', '34',
  '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47',
  '48', '50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '61',
  '62', '63', '64', '65', '66', '67', '68', '70', '71', '72', '73', '74', '75',
  '76', '77', '80', '81', '82', '83', '84', '85', '86', '87', '88', '90', '91',
  '92', '93', '94', '95', '98', '99'
])

/** EIN（XX-XXXXXXX）：校验前缀号段 */
export const isValidUSEIN = (ein: string): boolean => {
  const match = ein.match(/^(\d{2})-(\d{7})$/)
  if (!match) return false
  if (!EIN_PREFIXES.has(match[1])) return false
  // 后半段全 0 不对应任何实体
  return match[2] !== '0000000'
}

/**
 * 美国/北美电话（NANP）。
 * 区号与局号的首位必须是 2-9（0/1 保留作长途与话务前缀），
 * 这一条就足以把 `2024-01-0100` 这类日期/编号挡在门外。
 */
export const isValidUSPhone = (raw: string): boolean => {
  const digits = raw.replace(/\D/g, '')
  const nsn = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (nsn.length !== 10) return false
  const area = nsn.slice(0, 3)
  const exchange = nsn.slice(3, 6)
  if (area[0] < '2' || area[0] > '9') return false
  if (exchange[0] < '2' || exchange[0] > '9') return false
  // 555-0100..555-0199 是留作影视作品的号段，真实号码不会长这样
  if (area === '555' && exchange === '010') return false
  return true
}

// ============ 规则 ============

export const usRules: DetectionRule[] = [
  // 社保号：必须带连字符（无连字符的 9 位数字在文本里太容易撞车）
  {
    type: 'SSN',
    pattern: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g,
    confidence: 'high',
    extractor: (match) => {
      const ssn = match[0]
      if (!isValidUSSSN(ssn)) return null
      return {
        original: ssn,
        startIndex: match.index!,
        endIndex: match.index! + ssn.length
      }
    }
  },
  // 雇主识别号：**要求带标签**。裸 `\d{2}-\d{7}` 与日期区间、工单号、
  // 数量区间等无法区分，只靠号段校验不足以把误报压到可接受水平
  {
    type: 'EIN',
    pattern: /(?:\bEIN\b|\bFEIN\b|\bTIN\b|Tax\s*ID)[^\d\n]{0,12}(\d{2}-\d{7})(?!\d)/gi,
    confidence: 'high',
    extractor: (match) => {
      const ein = match[1]
      if (!isValidUSEIN(ein)) return null
      // 匹配整体含标签，只替换值本身（标签留在原文里，可读性更好）
      const valueStart = match.index! + match[0].lastIndexOf(ein)
      return {
        original: ein,
        startIndex: valueStart,
        endIndex: valueStart + ein.length
      }
    }
  },
  // 电话：允许 +1 / (NXX) / NXX-NXX-XXXX / NXX.NXX.XXXX 等常见写法
  {
    type: 'PHONE',
    pattern: /(?:\+1[-\s.]?)?(?:\(\d{3}\)|\d{3})[-\s.]\d{3}[-\s.]?\d{4}(?!\d)/g,
    confidence: 'high',
    extractor: (match) => {
      const phone = match[0]
      if (!isValidUSPhone(phone)) return null
      return {
        original: phone,
        startIndex: match.index!,
        endIndex: match.index! + phone.length
      }
    }
  }
]
