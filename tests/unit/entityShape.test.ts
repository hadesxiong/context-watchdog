// 单元用例 - 模型检出形状门禁（GLiNER 幻觉拦截，2026-10-18 实机反馈轮引入）
import { describe, it, expect } from 'vitest'
import { isPlausibleEntity } from '../../src/core/detector/entityShape'

describe('模型检出形状门禁', () => {
  it('拦截 2026-10-18 实机幻觉（户/订/注/放/前台）', () => {
    expect(isPlausibleEntity('户', 'person name')).toBe(false)
    expect(isPlausibleEntity('订', 'access token')).toBe(false)
    expect(isPlausibleEntity('订', 'email address')).toBe(false)
    expect(isPlausibleEntity('订', 'password')).toBe(false)
    expect(isPlausibleEntity('注', 'password')).toBe(false)
    expect(isPlausibleEntity('放', 'access token')).toBe(false)
    expect(isPlausibleEntity('前台', 'home address')).toBe(false)
  })

  it('放行形似的真值候选', () => {
    expect(isPlausibleEntity('李雷', 'person name')).toBe(true)
    expect(isPlausibleEntity('John Smith', 'person name')).toBe(true)
    expect(isPlausibleEntity('13905551234', 'phone number')).toBe(true)
    expect(isPlausibleEntity('上海市浦东新区世纪大道100号', 'home address')).toBe(true)
    expect(isPlausibleEntity('li.lei@example.com', 'email address')).toBe(true)
    expect(isPlausibleEntity('Tr0ub4dor!#2024', 'password')).toBe(true)
    expect(isPlausibleEntity('sk_live_51N3xAbCdEfGhIjKlMnOpQrStUv', 'api key')).toBe(true)
  })

  it('数字类标签按位数校验', () => {
    expect(isPlausibleEntity('1234', 'phone number')).toBe(false)
    expect(isPlausibleEntity('6222021202021234568', 'bank card number')).toBe(true)
    expect(isPlausibleEntity('622202120202123', 'bank card number')).toBe(true)
    expect(isPlausibleEntity('11010119900101', 'ID card number')).toBe(false)
    expect(isPlausibleEntity('110101199001011234', 'ID card number')).toBe(true)
  })

  it('姓名含数字/邮箱缺点视为不形似', () => {
    expect(isPlausibleEntity('李雷2号', 'person name')).toBe(false)
    expect(isPlausibleEntity('a@b', 'email address')).toBe(false)
    expect(isPlausibleEntity('世纪大道 100 号，联系电话', 'home address')).toBe(false)
  })

  it('标签归一化：下划线式与大小写不敏感', () => {
    expect(isPlausibleEntity('short', 'API_KEY')).toBe(false)
    expect(isPlausibleEntity('abcdefg_hi', 'api_key')).toBe(true)
    expect(isPlausibleEntity('户', 'PERSON_NAME')).toBe(false)
  })

  it('未知标签走默认规则（≥2 字、无中文句读）', () => {
    expect(isPlausibleEntity('新', 'custom label')).toBe(false)
    expect(isPlausibleEntity('订单', 'custom label')).toBe(true)
    expect(isPlausibleEntity('备注：前台', 'custom label')).toBe(false)
  })
})
