// 区域规则集（US / EU）：重点不是「能不能匹配」而是「该拒的有没有拒」—— 裸正则的误报率
// 会高到没人敢开，所以每条规则都要配一组「形似但不合法」的反例。

import { describe, it, expect } from 'vitest'
import {
  isValidUSSSN,
  isValidUSEIN,
  isValidUSPhone
} from '@engine/detector/rules/usRules'
import { isValidIBAN, isValidEUVAT } from '@engine/detector/rules/euRules'
import { scanRegexRules } from '@engine/detector/rules'
import { usRules } from '@engine/detector/rules/usRules'
import { euRules } from '@engine/detector/rules/euRules'
import { detect } from '@engine/detector'
import { getProfileById } from '@engine/detector/profiles'

// 静默管线里的 console.log（扫描器逐规则打印，噪声很大）
const silent = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  const original = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = original
  }
}

describe('US - SSN 校验', () => {
  it('接受合法号段', () => {
    expect(isValidUSSSN('457-55-5462')).toBe(true)
    expect(isValidUSSSN('123-45-6789')).toBe(true)
  })

  it('拒绝 SSA 从未签发的号段', () => {
    expect(isValidUSSSN('000-45-6789')).toBe(false) // 区号 000
    expect(isValidUSSSN('666-45-6789')).toBe(false) // 区号 666
    expect(isValidUSSSN('900-45-6789')).toBe(false) // 区号 900-999
    expect(isValidUSSSN('987-00-6789')).toBe(false) // 组号 00
    expect(isValidUSSSN('987-65-0000')).toBe(false) // 序号 0000
    expect(isValidUSSSN('111-11-1111')).toBe(false) // 全同数字
  })

  it('拒绝格式不对的串', () => {
    expect(isValidUSSSN('457555462')).toBe(false) // 无连字符
    expect(isValidUSSSN('457-555-462')).toBe(false) // 组号位数不对
  })
})

describe('US - EIN 校验', () => {
  it('只接受已分配的前缀', () => {
    expect(isValidUSEIN('12-3456789')).toBe(true)
    expect(isValidUSEIN('99-1234567')).toBe(true)
    expect(isValidUSEIN('00-1234567')).toBe(false) // 从未分配
    expect(isValidUSEIN('09-1234567')).toBe(false)
    expect(isValidUSEIN('12-0000000')).toBe(false) // 后半段全 0
  })
})

describe('US - 电话校验（NANP）', () => {
  it('接受常见写法', () => {
    expect(isValidUSPhone('(415) 555-2671')).toBe(true)
    expect(isValidUSPhone('415-555-2671')).toBe(true)
    expect(isValidUSPhone('+1 415 555 2671')).toBe(true)
    expect(isValidUSPhone('4155552671')).toBe(true)
  })

  it('拒绝区号/局号首位为 0 或 1 的串（这一条挡住绝大多数日期与编号）', () => {
    expect(isValidUSPhone('015-555-2671')).toBe(false)
    expect(isValidUSPhone('115-555-2671')).toBe(false)
    expect(isValidUSPhone('415-055-2671')).toBe(false)
    expect(isValidUSPhone('415-155-2671')).toBe(false)
  })

  it('拒绝位数不对的串', () => {
    expect(isValidUSPhone('415-555-267')).toBe(false)
    expect(isValidUSPhone('415-555-26711')).toBe(false)
  })
})

describe('EU - IBAN 校验（mod-97）', () => {
  it('接受官方样例（紧凑与分组写法都收）', () => {
    expect(isValidIBAN('DE89370400440532013000')).toBe(true)
    expect(isValidIBAN('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isValidIBAN('GB82 WEST 1234 5698 7654 32')).toBe(true)
    expect(isValidIBAN('FR14 2004 1010 0505 0001 3M02 606')).toBe(true)
  })

  it('拒绝校验位错误的串（形似但 mod-97 不过）', () => {
    expect(isValidIBAN('DE89370400440532013001')).toBe(false)
    expect(isValidIBAN('GB82WEST12345698765433')).toBe(false)
  })

  it('拒绝长度越界的串', () => {
    expect(isValidIBAN('DE89370400440532')).toBe(false) // 过短
    expect(isValidIBAN('DE893704004405320130000000000000000')).toBe(false) // 过长
  })

  it('拒绝小写以外的杂字符', () => {
    expect(isValidIBAN('DE89-3704-0044-0532-0130-0O')).toBe(false)
    expect(isValidIBAN('')).toBe(false)
  })
})

describe('EU - VAT 逐国格式', () => {
  it('接受常见国家的合法格式', () => {
    expect(isValidEUVAT('DE123456789')).toBe(true)
    expect(isValidEUVAT('FR12345678901')).toBe(true)
    expect(isValidEUVAT('NL123456789B01')).toBe(true)
    expect(isValidEUVAT('IT12345678901')).toBe(true)
    expect(isValidEUVAT('EL123456789')).toBe(true) // 希腊用 EL 而非 GR
    expect(isValidEUVAT('de 123 456 789')).toBe(true) // 小写与分隔符会被归一化
  })

  it('拒绝未收录的国家与位数不对的串', () => {
    expect(isValidEUVAT('GR123456789')).toBe(false) // 希腊必须写 EL
    expect(isValidEUVAT('US123456789')).toBe(false) // 非欧盟
    expect(isValidEUVAT('DE12345678')).toBe(false) // 位数少一位
    expect(isValidEUVAT('NL123456789001')).toBe(false) // 缺 B
  })
})

describe('区域规则集 - 接入扫描器', () => {
  it('US 集能检出 SSN / 电话，并给出正确区间', async () => {
    const text = 'SSN 457-55-5462, phone (415) 555-2671'
    const items = await silent(() => scanRegexRules(text, usRules, { enableEntropy: false }))
    const ssn = items.find(i => i.type === 'SSN')
    expect(ssn?.original).toBe('457-55-5462')
    expect(text.slice(ssn!.startIndex, ssn!.endIndex)).toBe('457-55-5462')
    expect(items.some(i => i.type === 'PHONE' && i.original === '(415) 555-2671')).toBe(true)
  })

  it('EIN 必须带标签，且只替换值本身（标签留在原文里）', async () => {
    const withLabel = 'Employer EIN: 12-3456789 on file'
    const items = await silent(() => scanRegexRules(withLabel, usRules, { enableEntropy: false }))
    const ein = items.find(i => i.type === 'EIN')
    expect(ein?.original).toBe('12-3456789')
    expect(withLabel.slice(ein!.startIndex, ein!.endIndex)).toBe('12-3456789')

    // 裸号（无标签）不进结果——否则日期区间之类会被大量误判
    const bare = await silent(() => scanRegexRules('range 12-3456789 here', usRules, { enableEntropy: false }))
    expect(bare.some(i => i.type === 'EIN')).toBe(false)
  })

  it('EU 集能检出 IBAN，VAT 的粗筛结果由逐国格式收口', async () => {
    const text = 'IBAN DE89 3704 0044 0532 0130 00 / VAT DE123456789 / 无效 FR123'
    const items = await silent(() => scanRegexRules(text, euRules, { enableEntropy: false }))
    expect(items.filter(i => i.type === 'IBAN')).toHaveLength(1)
    expect(items.filter(i => i.type === 'VAT').map(i => i.original)).toEqual(['DE123456789'])
  })
})

describe('区域档案 - 默认不启用，选了才追加', () => {
  it('universal 档案不启用区域规则（默认零误报）', async () => {
    const text = 'SSN 457-55-5462 / IBAN DE89370400440532013000'
    const result = await silent(() => detect(text, getProfileById('universal'), { enableAI: false }))
    const types = result.items.flatMap(i => i.detectionTypes ?? [i.type])
    expect(types).not.toContain('SSN')
    expect(types).not.toContain('IBAN')
  })

  it('us 档案检出 SSN，但不检出 EU 的 IBAN', async () => {
    const text = 'SSN 457-55-5462 / IBAN DE89370400440532013000'
    const result = await silent(() => detect(text, getProfileById('us'), { enableAI: false }))
    const types = result.items.flatMap(i => i.detectionTypes ?? [i.type])
    expect(types).toContain('SSN')
    expect(types).not.toContain('IBAN')
  })

  it('eu 档案检出 IBAN，但不检出美国的 SSN', async () => {
    const text = 'SSN 457-55-5462 / IBAN DE89370400440532013000'
    const result = await silent(() => detect(text, getProfileById('eu'), { enableAI: false }))
    const types = result.items.flatMap(i => i.detectionTypes ?? [i.type])
    expect(types).toContain('IBAN')
    expect(types).not.toContain('SSN')
  })

  it('区域类型有对应占位符名（两种语言都在）', async () => {
    const { generatePlaceholder, setPlaceholderLocale } = await import('@engine/replacer/placeholder')
    setPlaceholderLocale('zh_CN')
    expect(generatePlaceholder('SSN', 1)).toBe('<<社保号>>')
    expect(generatePlaceholder('IBAN', 1)).toBe('<<IBAN>>')
    setPlaceholderLocale('en')
    expect(generatePlaceholder('SSN', 1)).toBe('<<SSN>>')
    expect(generatePlaceholder('VAT', 2)).toBe('<<VAT:2>>')
    setPlaceholderLocale('zh_CN')
  })
})
