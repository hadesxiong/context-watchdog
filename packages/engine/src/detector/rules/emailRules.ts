// EMAIL 规则 - 邮箱地址检测
// 策略：识别但默认保留（keep），由 stores/detection.ts 的 DEFAULT_ACTION_BY_TYPE 控制
// 同时作为高熵规则和 DB_PASSWORD 独立规则在 @ 场景下的"让位"对象

import type { DetectionRule } from '../../types'

export const emailRules: DetectionRule[] = [
  {
    // 邮箱地址：local@domain.tld（domain 至少一个点，TLD 2+ 字母）
    // 排除纯数字 TLD，避免匹配 "12345@123.45" 这类密码片段
    type: 'EMAIL',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g,
    confidence: 'high'
  }
]
