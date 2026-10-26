// 值质量过滤器：弱密码字典、最小长度、纯数字检查；isWeakPassword 剥离纯数字后缀再查表；shouldSkipValue 综合校验。

export const WEAK_PASSWORDS = [
  'password', 'admin', 'secret', '123456', 'root', 'test',
  'changeme', 'default', 'pass', 'qwerty', 'abc123',
  'letmein', 'welcome', 'monkey', 'master', 'dragon',
  'login', 'princess', 'solo', 'qwe123', 'trustno1'
]

export const MIN_PASSWORD_LENGTH = 4

export const isWeakPassword = (value: string): boolean => {
  const lower = value.toLowerCase()
  if (WEAK_PASSWORDS.includes(lower)) return true

  const stripped = lower.replace(/\d+$/, '')
  if (stripped.length >= 4 && WEAK_PASSWORDS.includes(stripped)) return true

  return false
}

export const isTooShort = (value: string): boolean => {
  return value.length < MIN_PASSWORD_LENGTH
}

export const isNumericOnly = (value: string): boolean => {
  return /^\d+$/.test(value)
}

export const shouldSkipValue = (value: string): { skip: boolean; reason?: string } => {
  if (!value || value.length === 0) {
    return { skip: true, reason: 'empty' }
  }
  if (isTooShort(value)) {
    return { skip: true, reason: 'too_short' }
  }
  if (isNumericOnly(value)) {
    return { skip: true, reason: 'numeric_only' }
  }
  if (isWeakPassword(value)) {
    return { skip: true, reason: 'weak_password' }
  }
  return { skip: false }
}
