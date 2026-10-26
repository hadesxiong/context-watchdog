import type { DetectionItem, ReplaceConfig, MappingTable, ProfileConfig } from '../types'
import { getMappingManager, MappingManager } from './mapping'
import { resolveDefaultAction } from '../detector/profiles'

// 替换引擎
export class Replacer {
  // 应用替换（纯函数：每次用局部 MappingManager、不改单例状态——否则 sanitizedText 的 computed 会因副作用反复触发、映射表错乱）
  apply(
    text: string,
    detections: DetectionItem[],
    configs: ReplaceConfig[]
  ): { sanitizedText: string; mappingTable: MappingTable } {
    const mappingManager = new MappingManager()
    const mappingTable = mappingManager.applyConfigs(configs, detections)

    // 按位置排序检测项（从后往前替换，避免索引偏移）
    const sortedDetections = [...detections].sort(
      (a, b) => b.startIndex - a.startIndex
    )

    let sanitizedText = text

    for (const detection of sortedDetections) {
      const config = configs.find(c => c.itemId === detection.id)

      if (config?.action === 'keep') {
        continue
      }

      // 同 original 值共享同一占位符
      const placeholder = mappingManager.getPlaceholder(detection.original)
      if (placeholder) {
        sanitizedText =
          sanitizedText.substring(0, detection.startIndex) +
          placeholder +
          sanitizedText.substring(detection.endIndex)
      }
    }

    return {
      sanitizedText,
      mappingTable
    }
  }

  replaceAll(
    text: string,
    detections: DetectionItem[]
  ): { sanitizedText: string; mappingTable: MappingTable } {
    const configs: ReplaceConfig[] = detections.map(d => ({
      itemId: d.id,
      action: 'replace'
    }))

    return this.apply(text, detections, configs)
  }

  keepAll(
    text: string,
    _detections: DetectionItem[]
  ): { sanitizedText: string; mappingTable: MappingTable } {
    return {
      sanitizedText: text,
      mappingTable: {}
    }
  }

  // 清空映射表（清空单例；apply 已不再依赖单例）
  clearMapping(): void {
    getMappingManager().clear()
  }

  // 获取当前映射表（返回单例快照；apply 的映射表请以返回值为准）
  getMappingTable(): MappingTable {
    return getMappingManager().getMappings()
  }
}

// 单例替换引擎实例
let replacer: Replacer | null = null

export const getReplacer = (): Replacer => {
  if (!replacer) {
    replacer = new Replacer()
  }
  return replacer
}

export const sanitizeText = (
  text: string,
  detections: DetectionItem[],
  action: 'replace' | 'keep' = 'replace'
): { sanitizedText: string; mappingTable: MappingTable } => {
  const replacer = getReplacer()

  if (action === 'keep') {
    return replacer.keepAll(text, detections)
  }

  return replacer.replaceAll(text, detections)
}

// 按 Profile 的默认策略脱敏：判定为「保留」的识别项（不限档的邮箱/高熵/IP、tierLowConfidence
// 档下的中低置信项）原样留下，其余替换成占位符。粘贴拦截的正则首答与 AI 二次升级都必须走这里
// ——直接调 sanitizeText 会无条件替换全部识别项、绕过 keep 判定，把「保留」项也一并脱敏。
export const sanitizeWithProfile = (
  text: string,
  detections: DetectionItem[],
  profile: ProfileConfig
): { sanitizedText: string; mappingTable: MappingTable } => {
  const configs: ReplaceConfig[] = detections.map(d => ({
    itemId: d.id,
    action: resolveDefaultAction(profile, d.type, d.confidence)
  }))
  return getReplacer().apply(text, detections, configs)
}
