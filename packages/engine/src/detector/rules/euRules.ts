// 欧盟区域规则集：IBAN mod-97 强校验（high）、VAT 逐国格式校验（medium，希腊前缀 EL 非笔误）。

import type { DetectionRule } from '../../types'

// IBAN mod-97 校验（ISO 13616）：前 4 位移到末尾、字母换两位数字（A=10…Z=35）后对 97 取模须为 1（逐位取模避免大整数溢出）；不另对照「每国固定长度表」——mod-97 已是强校验。
export const isValidIBAN = (raw: string): boolean => {
  const iban = raw.replace(/[\s-]/g, '').toUpperCase()
  if (iban.length < 15 || iban.length > 34) return false
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false

  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const chunk = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const digit of chunk) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder === 1
}

// 欧盟各国增值税号格式（含 XI = 北爱尔兰）
const EU_VAT_PATTERNS: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE(?:\d[A-Z0-9]\d{5}[A-Z]|[A-Z]\d{7}[A-Z])$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(?:\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
  XI: /^XI\d{9}$/
}

export const isValidEUVAT = (raw: string): boolean => {
  const vat = raw.replace(/[\s.-]/g, '').toUpperCase()
  const pattern = EU_VAT_PATTERNS[vat.slice(0, 2)]
  return !!pattern && pattern.test(vat)
}

const VAT_PREFIX_SOURCE = Object.keys(EU_VAT_PATTERNS).join('|')

export const euRules: DetectionRule[] = [
  // IBAN：支持紧凑写法与每 4 位一组的印刷写法
  {
    type: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{4}){2,7}[A-Z0-9]{0,3}\b|\b[A-Z]{2}\d{2}(?:\s[A-Z0-9]{4}){2,7}(?:\s[A-Z0-9]{1,4})?\b/g,
    confidence: 'high',
    extractor: (match) => {
      const iban = match[0]
      if (!isValidIBAN(iban)) return null
      return {
        original: iban,
        startIndex: match.index!,
        endIndex: match.index! + iban.length
      }
    }
  },
  // 增值税号：正则先粗筛（国家前缀 + 字母数字尾巴），再由逐国格式判定
  {
    type: 'VAT',
    pattern: new RegExp(`\\b(?:${VAT_PREFIX_SOURCE})[A-Z0-9]{3,13}\\b`, 'g'),
    confidence: 'medium',
    extractor: (match) => {
      const vat = match[0]
      if (!isValidEUVAT(vat)) return null
      return {
        original: vat,
        startIndex: match.index!,
        endIndex: match.index! + vat.length
      }
    }
  }
]
