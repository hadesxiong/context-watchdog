import type { MappingTable, ReplaceConfig, DetectionItem } from '../types'

// 映射表管理器
export class MappingManager {
  private mappingTable: MappingTable = {}
  private reverseMapping: Map<string, string> = new Map()

  // 添加映射
  addMapping(placeholder: string, original: string): void {
    this.mappingTable[placeholder] = original
    this.reverseMapping.set(original, placeholder)
  }

  // 获取原文
  getOriginal(placeholder: string): string | undefined {
    return this.mappingTable[placeholder]
  }

  // 获取占位符
  getPlaceholder(original: string): string | undefined {
    return this.reverseMapping.get(original)
  }

  // 检查是否已存在映射
  hasMapping(original: string): boolean {
    return this.reverseMapping.has(original)
  }

  // 获取或创建映射
  getOrCreateMapping(
    original: string,
    placeholder: string
  ): string {
    const existing = this.getPlaceholder(original)
    if (existing) {
      return existing
    }

    this.addMapping(placeholder, original)
    return placeholder
  }

  // 清空映射表
  clear(): void {
    this.mappingTable = {}
    this.reverseMapping.clear()
  }

  // 获取所有映射
  getMappings(): MappingTable {
    return { ...this.mappingTable }
  }

  // 获取映射数量
  get size(): number {
    return Object.keys(this.mappingTable).length
  }

  // 从检测项构建映射表
  buildFromDetections(detections: DetectionItem[]): void {
    for (const detection of detections) {
      this.addMapping(detection.placeholder, detection.original)
    }
  }

  // 应用替换配置
  applyConfigs(configs: ReplaceConfig[], detections: DetectionItem[]): MappingTable {
    const result: MappingTable = {}

    for (const detection of detections) {
      const config = configs.find(c => c.itemId === detection.id)

      if (!config || config.action === 'replace') {
        // 默认替换，使用映射表中的值或创建新映射
        const placeholder = this.getOrCreateMapping(
          detection.original,
          config?.customPlaceholder || detection.placeholder
        )
        result[placeholder] = detection.original
      } else if (config.action === 'keep') {
        // 保留原文，不添加到映射表
        continue
      }
    }

    return result
  }
}

// 单例映射管理器实例
let mappingManager: MappingManager | null = null

export const getMappingManager = (): MappingManager => {
  if (!mappingManager) {
    mappingManager = new MappingManager()
  }
  return mappingManager
}
