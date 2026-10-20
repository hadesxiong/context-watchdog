// 五步检测管线（Phase 2：Profile 驱动 + GLiNER 级联触发）

import type { DetectionItem, DetectionResult, DetectionType, Confidence, ProfileConfig } from '../types'
import { detectScene, type SceneResult } from './sceneDetector'
import {
  categorizeEntity,
  getInferenceBackend,
  type ContentEntity
} from './backend'
import { scanRegexRules, rulesByCategory } from './regexRules'
import { scanCustomRules } from './rules/customRules'
import { getProfileById, DEFAULT_PROFILE_ID, getSensitivity, ENTROPY_THRESHOLDS } from './profiles'
import { generatePlaceholder } from '../replacer/placeholder'
import { generateId } from '../utils/id'

// 检测引擎配置（正则为基础引擎恒开；场景识别为 AI 分支内部细节，不单独暴露开关）
interface DetectorConfig {
  enableContentDetection: boolean
}

const defaultConfig: DetectorConfig = {
  enableContentDetection: true
}

// GLiNER 实体类型到 DetectionType 的映射（密钥类 + PII 类）
const entityTypeMap: Record<string, DetectionType> = {
  'password': 'ENV_PASSWORD',
  'secret': 'ENV_PASSWORD',
  'api_key': 'API_KEY',
  'api key': 'API_KEY',
  'access_token': 'API_KEY',
  'access token': 'API_KEY',
  'connection_string': 'DB_PASSWORD',
  'connection string': 'DB_PASSWORD',
  'database_credentials': 'DB_PASSWORD',
  'private_key': 'PRIVATE_KEY',
  'private key': 'PRIVATE_KEY',
  'jwt_token': 'JWT',
  'credential': 'ENV_PASSWORD',
  'token': 'API_KEY',
  'person name': 'NAME',
  'phone number': 'PHONE',
  'home address': 'ADDRESS',
  'email address': 'EMAIL',
  'ID card number': 'ID_CARD',
  'bank card number': 'BANK_CARD'
}

// PII 类实体标签（不做通用值质量校验——姓名/地址天然短小）
const PII_LABELS = new Set([
  'person name', 'phone number', 'home address', 'email address', 'ID card number', 'bank card number'
])

// 将 ContentEntity 转换为 DetectionItem
const toDetectionItem = (entity: ContentEntity): DetectionItem => {
  const type = entityTypeMap[entity.entityType] || 'HIGH_ENTROPY'
  const confidence: Confidence = entity.confidence > 0.8 ? 'high' : entity.confidence > 0.5 ? 'medium' : 'low'
  
  return {
    id: generateId(),
    type,
    original: entity.text,
    placeholder: `<<${type}:0>>`,
    startIndex: entity.startIndex,
    endIndex: entity.endIndex,
    confidence,
    context: entity.text,
    detectionTypes: [type],
    source: 'model'
  }
}

// 正则验证敏感实体
const validateSensitiveEntity = (entity: ContentEntity): boolean => {
  const value = entity.text

  // PII 类实体不做通用值质量校验（姓名/地址天然短小，长度过滤会误杀）
  if (PII_LABELS.has(entity.entityType)) {
    return value.length >= 2
  }

  // API Key 格式验证
  if (entity.entityType === 'api_key') {
    if (/^(sk-|AKIA|ghp_|xox[baprs]-)/.test(value)) return true
    if (/^[A-Za-z0-9]{20,}$/.test(value)) return true
    return false
  }
  
  // 连接串格式验证
  if (entity.entityType === 'connection_string') {
    if (/^[a-z]+:\/\/[^\s]+/.test(value)) return true
    return false
  }
  
  // JWT 格式验证
  if (entity.entityType === 'jwt_token') {
    if (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true
    return false
  }
  
  // 通用值质量校验（模型结果也需要）
  if (value.length < 4) return false
  if (/^\d+$/.test(value)) return false
  const weakPasswords = ['password', 'admin', 'secret', '123456', 'root', 'test', 'changeme', 'default']
  if (weakPasswords.includes(value.toLowerCase())) return false
  
  // 其他类型保持原判断
  return true
}

// 置信度权重表（重叠仲裁与合并用）
const confidenceOrder: Record<Confidence, number> = { high: 3, medium: 2, low: 1 }

// 类型优先级（重叠仲裁用）：凭据类 > PII 类 > 高熵
// 例：连接串密码 (DB_PASSWORD) 必须击败覆盖它的 EMAIL span，
// 邮箱 span 必须击败包含它的 HIGH_ENTROPY span
const typePriority: Record<DetectionType, number> = {
  ENV_PASSWORD: 3,
  API_KEY: 3,
  DB_PASSWORD: 3,
  JWT: 3,
  PRIVATE_KEY: 3,
  EMAIL: 2,
  PHONE: 2,
  ID_CARD: 2,
  BANK_CARD: 2,
  IP_ADDRESS: 2,
  PLATE: 2,
  NAME: 2,
  ADDRESS: 2,
  // 区域标识符（SSN/EIN/IBAN/VAT）是强校验的高可信标识，与身份证/银行卡同级：
  // 它们比包住自己的高熵串更具体，仲裁时应胜出
  SSN: 2,
  EIN: 2,
  IBAN: 2,
  VAT: 2,
  HIGH_ENTROPY: 1
}

const itemPriority = (item: DetectionItem): number =>
  Math.max(...(item.detectionTypes || [item.type]).map(t => typePriority[t] || 0))

// 合并类型与置信度到目标项
const mergeMeta = (target: DetectionItem, source: DetectionItem): void => {
  const targetTypes = target.detectionTypes || [target.type]
  const sourceTypes = source.detectionTypes || [source.type]
  target.detectionTypes = Array.from(new Set([...targetTypes, ...sourceTypes]))

  if ((confidenceOrder[source.confidence] || 0) > (confidenceOrder[target.confidence] || 0)) {
    target.confidence = source.confidence
  }
  if (source.source && !target.source) {
    target.source = source.source
  }
}

// 位置去重：完全相同 span 的项合并为一条（类型合并、置信度取最高）
const deduplicateByPosition = (items: DetectionItem[]): DetectionItem[] => {
  const positionSeen = new Map<string, DetectionItem>()

  for (const item of items) {
    const key = `${item.startIndex}-${item.endIndex}`
    const existing = positionSeen.get(key)

    if (existing) {
      mergeMeta(existing, item)
    } else {
      positionSeen.set(key, { ...item })
    }
  }

  return Array.from(positionSeen.values())
}

// 重叠区间归并：保证任意两个检测项区间不相交，防止替换时互相切坏输出
// 仲裁规则：
// - 完全包含 → 保留容器（长 span 胜），被包含方类型并入
// - 部分重叠 → 置信度高者胜，平局取长 span，再平局取先出现者
const resolveOverlaps = (items: DetectionItem[]): DetectionItem[] => {
  const sorted = [...items].sort(
    (a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex
  )

  const pickWinner = (a: DetectionItem, b: DetectionItem): DetectionItem => {
    // 类型优先级优先：凭据类 > PII > 高熵
    const prioDiff = itemPriority(b) - itemPriority(a)
    if (prioDiff !== 0) return prioDiff > 0 ? b : a

    // 同优先级且一方完全包含另一方 → 保留容器（长 span 胜）
    const aContains = a.startIndex <= b.startIndex && a.endIndex >= b.endIndex
    const bContains = b.startIndex <= a.startIndex && b.endIndex >= a.endIndex
    if (aContains && !bContains) return a
    if (bContains && !aContains) return b

    const scoreDiff = (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0)
    if (scoreDiff !== 0) return scoreDiff > 0 ? b : a

    const lenDiff = (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex)
    if (lenDiff !== 0) return lenDiff > 0 ? b : a

    return a.startIndex <= b.startIndex ? a : b
  }

  const result: DetectionItem[] = []
  for (const item of sorted) {
    const last = result[result.length - 1]

    if (!last || item.startIndex >= last.endIndex) {
      result.push({ ...item })
      continue
    }

    // 与前一项重叠：仲裁后保留胜者
    const winner = pickWinner(last, item)
    const loser = winner === last ? item : last
    mergeMeta(winner, loser)
    result[result.length - 1] = winner === last ? last : { ...item }
  }

  return result
}

// 按值聚合：相同 original 的项保留所有出现位置（修复重复值泄漏），
// 但合并类型信息到首次出现项，供 UI 合并展示
const aggregateByValue = (items: DetectionItem[]): DetectionItem[] => {
  const valueSeen = new Map<string, DetectionItem>()

  for (const item of items) {
    const first = valueSeen.get(item.original)
    if (first) {
      mergeMeta(first, item)
    } else {
      valueSeen.set(item.original, item)
    }
  }

  return items
}

// 值传播：凭据类值一旦被某条规则识别，正文中其余裸露出现同样标记为敏感
// （修复"重复值只能识别第一个"的另一半根因：裸露出现无 KEY= 上下文，规则无法命中）
const PROPAGATION_MIN_LENGTH = 8

const propagateKnownValues = (items: DetectionItem[], text: string): DetectionItem[] => {
  const propagated: DetectionItem[] = []

  for (const item of items) {
    // 仅传播高优先级凭据类，且值足够长以避免误伤常见词
    if ((typePriority[item.type] || 0) < 3 || item.original.length < PROPAGATION_MIN_LENGTH) continue

    let fromIndex = 0
    while (true) {
      const idx = text.indexOf(item.original, fromIndex)
      if (idx === -1) break
      fromIndex = idx + item.original.length

      // 跳过已被检测项覆盖的位置
      const covered = items.some(
        existing => idx >= existing.startIndex && idx + item.original.length <= existing.endIndex
      ) || propagated.some(
        existing => idx >= existing.startIndex && idx + item.original.length <= existing.endIndex
      )
      if (covered) continue

      propagated.push({
        ...item,
        id: generateId(),
        startIndex: idx,
        endIndex: idx + item.original.length,
        context: text.substring(Math.max(0, idx - 20), idx + item.original.length + 20),
        source: item.source
      })
    }
  }

  if (propagated.length > 0) {
    console.log('[ContextWatchdog] Propagated', propagated.length, 'repeated occurrences of known values')
  }
  return [...items, ...propagated]
}

// 值白名单过滤：精确匹配的值不检测不替换（Phase 4 自定义档案）
// 放在值传播之后：白名单值的所有出现（含传播产生的）一并移除
const applyWhitelist = (items: DetectionItem[], whitelist?: string[]): DetectionItem[] => {
  if (!whitelist || whitelist.length === 0) return items
  const set = new Set(whitelist)
  const filtered = items.filter(item => !set.has(item.original))
  if (filtered.length !== items.length) {
    console.log('[ContextWatchdog] Whitelist filtered', items.length - filtered.length, 'items')
  }
  return filtered
}

// 重新生成占位符：相同 original 值共享同一占位符（同值必同占位符）
const regeneratePlaceholders = (items: DetectionItem[]): DetectionItem[] => {
  const placeholderByValue = new Map<string, string>()
  const typeCounters: Record<string, number> = {}

  return items.map(item => {
    const shared = placeholderByValue.get(item.original)
    if (shared) {
      return { ...item, placeholder: shared }
    }

    typeCounters[item.type] = (typeCounters[item.type] || 0) + 1
    const placeholder = generatePlaceholder(item.type, typeCounters[item.type])
    placeholderByValue.set(item.original, placeholder)
    return { ...item, placeholder }
  })
}

// ============ 级联触发辅助 ============

// 构建未被正则覆盖的文本片段（GLiNER 只处理这些片段，省电省时）
interface TextSegment { text: string; offset: number }

const buildUncoveredSegments = (
  text: string,
  covered: Array<{ startIndex: number; endIndex: number }>,
  maxSegments = 20,
  maxTotalChars = 8000
): TextSegment[] => {
  // 合并覆盖区间
  const merged = [...covered]
    .sort((a, b) => a.startIndex - b.startIndex)
    .reduce<Array<{ startIndex: number; endIndex: number }>>((acc, cur) => {
      const last = acc[acc.length - 1]
      if (last && cur.startIndex <= last.endIndex) {
        last.endIndex = Math.max(last.endIndex, cur.endIndex)
      } else {
        acc.push({ ...cur })
      }
      return acc
    }, [])

  const segments: TextSegment[] = []
  let cursor = 0
  let totalChars = 0

  for (const region of merged) {
    if (cursor < region.startIndex) {
      const segText = text.substring(cursor, region.startIndex)
      // 跳过过短片段（GLiNER 需要上下文）
      if (segText.trim().length >= 8 && segments.length < maxSegments && totalChars + segText.length <= maxTotalChars) {
        segments.push({ text: segText, offset: cursor })
        totalChars += segText.length
      }
    }
    cursor = Math.max(cursor, region.endIndex)
  }

  // 尾部
  if (cursor < text.length) {
    const segText = text.substring(cursor)
    if (segText.trim().length >= 8 && segments.length < maxSegments && totalChars + segText.length <= maxTotalChars) {
      segments.push({ text: segText, offset: cursor })
    }
  }

  return segments
}

// Step 5b: uncertain 实体回流正则复检
const recheckWithRegex = (entity: ContentEntity): DetectionItem[] => {
  const rules = rulesByCategory.secret
  const rechecked = scanRegexRules(entity.text, rules, { enableEntropy: false })
  return rechecked.map(item => ({
    ...item,
    id: generateId(),
    original: item.original,
    startIndex: entity.startIndex + item.startIndex,
    endIndex: entity.startIndex + item.endIndex,
    source: 'regex' as const,
    confidence: item.confidence === 'high' ? 'medium' as Confidence : item.confidence
  }))
}

// 主检测函数
export const detect = async (
  text: string,
  profile: ProfileConfig = getProfileById(DEFAULT_PROFILE_ID),
  config: Partial<DetectorConfig> = {}
): Promise<DetectionResult> => {
  const mergedConfig = { ...defaultConfig, ...config }
  let items: DetectionItem[] = []

  console.log('[ContextWatchdog] Pipeline started. Profile:', profile.id, 'Text length:', text.length)

  // Step 2: 按 Profile 启用的规则类别运行正则规则（正则为基础引擎恒开，
  // SW 粘贴拦截仅依赖此档，不提供关闭入口）
  console.log('[ContextWatchdog] Running regex rules for categories:', profile.enabledCategories.join(', '))
  const enabledRules = profile.enabledCategories.flatMap(cat => rulesByCategory[cat] || [])
  const enableEntropy = profile.enabledCategories.includes('entropy')
  const entropyThresholds = ENTROPY_THRESHOLDS[getSensitivity(profile, 'entropy')]

  const regexItems = scanRegexRules(text, enabledRules, { enableEntropy, entropyThresholds })
  console.log('[ContextWatchdog] Regex found', regexItems.length, 'items')

  // 为正则结果添加 source 标记
  for (const item of regexItems) {
    items.push({
      ...item,
      source: 'regex'
    })
  }

  // Step 2b: 用户自定义正则（ReDoS 校验 + 时间预算，Phase 5）
  const customRules = (profile.customRules || []).filter(r => r.enabled)
  if (customRules.length > 0) {
    const custom = scanCustomRules(text, customRules)
    console.log('[ContextWatchdog] Custom rules found', custom.items.length, 'items')
    for (const warning of custom.warnings) {
      console.warn('[ContextWatchdog]', warning)
    }
    items.push(...custom.items)
  }

  // Step 3-4: GLiNER 级联触发（仅处理正则未覆盖片段，如果模型可用）。
  // 场景识别为 AI 分支内部细节（仅喂给 GLiNER 提示词，不影响正则检出），
  // 随 AI 开关走：AI 关闭/模型未就绪时一并省去这步启发式（约 10ms）
  // 引擎不持有模型运行时：后端由宿主注册（getInferenceBackend），未注册即纯正则
  const backend = getInferenceBackend()
  if (mergedConfig.enableContentDetection && backend?.isReady()) {
    try {
      let scene: SceneResult = { type: 'plain', confidence: 0, scores: {} as any }
      try {
        scene = await detectScene(text)
        console.log('[ContextWatchdog] Scene:', scene.type, `(${(scene.confidence * 100).toFixed(1)}%)`)
      } catch (error) {
        console.warn('[ContextWatchdog] Scene detection failed, using default:', error)
      }

      const segments = buildUncoveredSegments(text, items)
      console.log('[ContextWatchdog] Cascade: sending', segments.length, 'uncovered segments to model')

      const entities: ContentEntity[] = []
      for (const segment of segments) {
        const segmentEntities = await backend.detectSegment(segment.text, scene.type, profile.glinerLabels)
        // 映射回全文偏移
        for (const e of segmentEntities) {
          entities.push({
            ...e,
            startIndex: e.startIndex + segment.offset,
            endIndex: e.endIndex + segment.offset,
            text: text.substring(e.startIndex + segment.offset, e.endIndex + segment.offset),
            scene: scene.type
          })
        }
      }
      console.log('[ContextWatchdog] Found', entities.length, 'entities from model')

      // 分类实体
      const sensitive = entities.filter(e => categorizeEntity(e) === 'sensitive')
      const uncertain = entities.filter(e => categorizeEntity(e) === 'uncertain')

      console.log(`[ContextWatchdog] Model categories: ${sensitive.length} sensitive, ${uncertain.length} uncertain`)

      // Step 5a: 验证并添加高置信度模型结果（跳过已被正则覆盖的）
      const validatedSensitive = sensitive.filter(e => validateSensitiveEntity(e))
      for (const entity of validatedSensitive) {
        const item = toDetectionItem(entity)
        const coveredByRegex = items.some(existing =>
          existing.startIndex <= item.startIndex &&
          existing.endIndex >= item.endIndex
        )
        if (!coveredByRegex) {
          items.push(item)
        }
      }

      // Step 5b: uncertain 实体回流正则复检（复检不中的以低置信度保留）
      for (const entity of uncertain) {
        const coveredByRegex = items.some(existing =>
          existing.startIndex <= entity.startIndex && existing.endIndex >= entity.endIndex
        )
        if (coveredByRegex) continue

        const rechecked = recheckWithRegex(entity)
        if (rechecked.length > 0) {
          for (const item of rechecked) {
            const stillCovered = items.some(existing =>
              existing.startIndex <= item.startIndex && existing.endIndex >= item.endIndex
            )
            if (!stillCovered) items.push(item)
          }
        } else {
          // 正则复检不中：保留模型判断，低置信度（tierLowConfidence 下默认仅提示）
          items.push(toDetectionItem({ ...entity, confidence: Math.min(entity.confidence, 0.5) }))
        }
      }
    } catch (error) {
      console.warn('[ContextWatchdog] Content detection failed, using regex only:', error)
    }
  } else {
    console.log('[ContextWatchdog] Model not ready, using regex only')
  }

  // 去重 → 排序 → 重叠归并 → 值传播 → 白名单过滤 → 按值聚合 → 占位符按值共享
  items = deduplicateByPosition(items)
  items.sort((a, b) => a.startIndex - b.startIndex)
  items = resolveOverlaps(items)
  items = propagateKnownValues(items, text)
  items = applyWhitelist(items, profile.whitelist)
  items.sort((a, b) => a.startIndex - b.startIndex)
  items = aggregateByValue(items)
  items = regeneratePlaceholders(items)

  console.log('[ContextWatchdog] Pipeline completed. Total items:', items.length)

  return { items, text }
}

// 预加载不属于引擎：宿主注册 InferenceBackend 后自行调用 backend.preload()
// （见 src/model/index.ts）
