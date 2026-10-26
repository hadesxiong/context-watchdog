// AI 推理后端抽象：引擎不持有模型运行时；单例注入让调用点零改动——tests 不注册即走纯正则，各宿主启动时注册自己的实现。
import type { SceneType } from './sceneDetector'

// 置信度分类阈值（GLiNER-small 在密钥/PII 场景超 0.8 的比例很低，上限只给 0.65）
export const CONFIDENCE_THRESHOLDS = {
  SENSITIVE: 0.65,     // > 0.65 → 显然敏感
  UNCERTAIN: 0.35,     // < 0.35 → 显然不敏感
  // 0.35 - 0.65 → 不确定（回流正则复检）
}

// 后端返回的实体（不含 scene：scene 由调用方一次性传入并掌握）
export interface InferenceEntity {
  text: string
  startIndex: number
  endIndex: number
  entityType: string
  confidence: number
}

// 检测管线内部使用的实体（带 scene 上下文）
export interface ContentEntity extends InferenceEntity {
  scene: SceneType
}

export type EntityCategory = 'sensitive' | 'not_sensitive' | 'uncertain'

// 按置信度分档。管线据此决定"验证后采纳"还是"回流正则复检"。
export const categorizeEntity = (entity: InferenceEntity): EntityCategory => {
  if (entity.confidence > CONFIDENCE_THRESHOLDS.SENSITIVE) {
    return 'sensitive'
  }
  if (entity.confidence < CONFIDENCE_THRESHOLDS.UNCERTAIN) {
    return 'not_sensitive'
  }
  return 'uncertain'
}

// 下载/加载进度：percent < 0 表示未知总长（UI 走不定进度动画）；received/total 供 UI 展示 MB
export type ModelProgress = (percent: number, received?: number, total?: number) => void

export interface InferenceBackend {
  /** 模型是否就绪（同步判定；管线据此决定是否走 AI 分支） */
  isReady(): boolean
  /** 预加载。回调语义与原有 preloadContentModel 完全一致 */
  preload(options?: {
    onProgress?: ModelProgress
    onWaiting?: (waiting: boolean) => void
    onDownloadStart?: () => void
  }): Promise<void>
  /** 对单个"未被正则覆盖"的片段做零样本实体抽取 */
  detectSegment(text: string, scene: SceneType, labels: string[]): Promise<InferenceEntity[]>
}

let current: InferenceBackend | null = null

export const setInferenceBackend = (backend: InferenceBackend | null): void => {
  current = backend
}

export const getInferenceBackend = (): InferenceBackend | null => current
