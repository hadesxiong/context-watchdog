// 内容检测器 - 使用 GLiNER 检测密钥和敏感信息

import type { SceneType } from './sceneDetector'

// 密钥相关实体类型（GLiNER 零样本标签）
const SECRET_LABELS = [
  'password',
  'secret',
  'api_key',
  'access_token',
  'connection_string',
  'database_credentials',
  'private_key',
  'jwt_token',
  'credential',
  'token'
]

// 置信度分类阈值（Phase 2 下调：GLiNER-small 在密钥/PII 场景超 0.8 的比例很低）
export const CONFIDENCE_THRESHOLDS = {
  SENSITIVE: 0.65,     // > 0.65 → 显然敏感
  UNCERTAIN: 0.35,     // < 0.35 → 显然不敏感
  // 0.35 - 0.65 → 不确定（回流正则复检）
}

// 内容实体接口
export interface ContentEntity {
  text: string
  startIndex: number
  endIndex: number
  entityType: string
  confidence: number
  scene: SceneType
}

// 实体分类
export type EntityCategory = 'sensitive' | 'not_sensitive' | 'uncertain'

// GLiNER 模型单例
let glinerInstance: any = null
let loading = false
let ready = false

// HuggingFace 镜像地址（中国大陆可访问）
const HF_MIRROR = 'https://hf-mirror.com'
const MODEL_URL = `${HF_MIRROR}/onnx-community/gliner_small-v2/resolve/main/model.onnx`

// 加载 GLiNER 模型
export const loadContentModel = async (): Promise<void> => {
  if (loading || ready) return
  loading = true

  try {
    // 设置 HuggingFace 镜像（在导入 gliner 之前）
    const transformers = await import('@huggingface/transformers')
    transformers.env.remoteHost = HF_MIRROR
    
    const { Gliner } = await import('gliner')
    const ort = await import('onnxruntime-web')

    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false

    glinerInstance = new Gliner({
      tokenizerPath: 'onnx-community/gliner_small-v2',
      onnxSettings: {
        modelPath: MODEL_URL,
        executionProvider: 'wasm',
        multiThread: false
      },
      transformersSettings: {
        allowLocalModels: false,
        useBrowserCache: true
      },
      // Phase 2: 12 → 256，长连接串/长 PII 不再被切成多个块
      maxWidth: 256,
      modelType: 'gliner'
    })

    await glinerInstance.initialize()

    ready = true
    loading = false
    console.log('[PasteGuard] Content detector ready')
  } catch (error) {
    loading = false
    console.error('[PasteGuard] Failed to load content model:', error)
    throw error
  }
}

// 检测内容实体
// labels: 零样本实体标签集（由 Profile 提供，级联触发时只送未被正则覆盖的片段）
export const detectContent = async (
  text: string,
  scene: SceneType,
  labels: string[] = SECRET_LABELS
): Promise<ContentEntity[]> => {
  if (!ready || !glinerInstance) {
    return []
  }

  try {
    const results = await glinerInstance.inference({
      texts: [text],
      entities: labels,
      threshold: 0.25,
      multiLabel: true
    })

    if (!results || !results[0]) {
      return []
    }

    return results[0].map((e: any) => ({
      text: e.spanText,
      startIndex: e.start,
      endIndex: e.end,
      entityType: e.label,
      confidence: e.score,
      scene
    }))
  } catch (error) {
    console.error('[PasteGuard] Content detection failed:', error)
    return []
  }
}

// 分类实体
export const categorizeEntity = (entity: ContentEntity): EntityCategory => {
  if (entity.confidence > CONFIDENCE_THRESHOLDS.SENSITIVE) {
    return 'sensitive'
  }
  if (entity.confidence < CONFIDENCE_THRESHOLDS.UNCERTAIN) {
    return 'not_sensitive'
  }
  return 'uncertain'
}

// 检查模型是否就绪
export const isContentModelReady = (): boolean => ready

// 预加载模型
export const preloadContentModel = async (): Promise<void> => {
  await loadContentModel()
}
