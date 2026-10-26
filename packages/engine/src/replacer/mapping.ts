import type { MappingTable, ReplaceConfig, DetectionItem } from '../types'

// 映射表管理器
export class MappingManager {
  private mappingTable: MappingTable = {}
  private reverseMapping: Map<string, string> = new Map()

  addMapping(placeholder: string, original: string): void {
    this.mappingTable[placeholder] = original
    this.reverseMapping.set(original, placeholder)
  }

  getOriginal(placeholder: string): string | undefined {
    return this.mappingTable[placeholder]
  }

  getPlaceholder(original: string): string | undefined {
    return this.reverseMapping.get(original)
  }

  hasMapping(original: string): boolean {
    return this.reverseMapping.has(original)
  }

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

  clear(): void {
    this.mappingTable = {}
    this.reverseMapping.clear()
  }

  getMappings(): MappingTable {
    return { ...this.mappingTable }
  }

  get size(): number {
    return Object.keys(this.mappingTable).length
  }

  buildFromDetections(detections: DetectionItem[]): void {
    for (const detection of detections) {
      this.addMapping(detection.placeholder, detection.original)
    }
  }

  applyConfigs(configs: ReplaceConfig[], detections: DetectionItem[]): MappingTable {
    const result: MappingTable = {}

    for (const detection of detections) {
      const config = configs.find(c => c.itemId === detection.id)

      if (!config || config.action === 'replace') {
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
