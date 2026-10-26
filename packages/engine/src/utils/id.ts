// 统一 ID 生成：ID 是 keep/replace 配置的关联 key，各模块自增计数会冲突、导致用户配置串项

export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `det_${crypto.randomUUID()}`
  }
  // 降级：时间戳 + 随机数
  return `det_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
