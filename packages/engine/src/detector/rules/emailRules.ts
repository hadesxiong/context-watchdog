// EMAIL 规则 - 邮箱地址检测
// 策略：识别但默认保留（keep）；同时是高熵规则和 DB_PASSWORD 独立规则在 @ 场景下的让位对象

import type { DetectionRule } from '../../types'

export const emailRules: DetectionRule[] = [
  {
    // 排除纯数字 TLD，避免匹配 "12345@123.45" 这类密码片段
    type: 'EMAIL',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g,
    confidence: 'high'
  }
]
