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

// 注意：模型文件在 onnx/ 子目录下（仓库根目录没有 model.onnx，直接请求会 404）。
// 选 model_quantized.onnx（int8 量化，约 183MB / 183,403,734 字节）：全量 model.onnx 达 611MB，不适合浏览器扩展
//
// 模型源（按顺序回退）：
// 1. ModelScope（阿里云）：`/models/{id}/resolve/{rev}/{path}` 端点的 302 带完整 CORS 头
//    （Access-Control-Allow-Origin: *，Allow-Headers 含 Range），末端 cdn-lfs-cn-1.modelscope.cn
//    返回与 HuggingFace 一致的 183,403,734 字节，国内实测约 14MB/s。
//    ⚠️ 不要换回 `/api/v1/models/{id}/repo?FilePath=...`：它的 302 没有 ACAO，同样会被 CORS 判死。
// 2. HuggingFace 官方源：302 会回显请求 Origin（CORS 通过），作为 ModelScope 镜像缺失时的兜底。
//
// ❌ 不要再用 hf-mirror.com：它已改为 308 跳转到 huggingface.co，且该 308 响应不带
// Access-Control-Allow-Origin。Fetch 规范对重定向链上的每一跳都要做 CORS 校验，
// 扩展页（manifest 未声明 host_permissions，只能走 CORS）会在第一跳直接抛
// TypeError: Failed to fetch —— 界面上表现为「网络请求被阻止或模型下载失败」。
const MODEL_SOURCES = [
  'https://modelscope.cn/models/onnx-community/gliner_small-v2/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/onnx-community/gliner_small-v2/resolve/main/onnx/model_quantized.onnx'
]

// 依次尝试模型源，返回第一个 HTTP 2xx 响应；全部失败时抛出带各源详情的错误
const fetchFirstOk = async (urls: string[]): Promise<Response> => {
  const failures: string[] = []
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      failures.push(`${new URL(url).host}: HTTP ${res.status}`)
      console.warn('[PasteGuard] 模型源返回非 2xx，尝试下一个源：', url, res.status)
    } catch (error) {
      // 典型：CORS 或网络中断导致的 TypeError: Failed to fetch
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`)
      console.warn('[PasteGuard] 模型源请求失败，尝试下一个源：', url, error)
    }
  }
  throw new Error(`模型下载失败：所有模型源均不可用（${failures.join('；')}）`)
}

// 加载 GLiNER 模型
// onProgress: 真实下载进度回调（0-100）；model_quantized.onnx 约 183MB，自行流式下载后
// 以 ArrayBuffer 传入 gliner（其 modelPath 支持二进制），从而获得真实字节数进度
export const loadContentModel = async (
  onProgress?: (percent: number) => void
): Promise<void> => {
  if (loading || ready) return
  loading = true

  try {
    // 注意：gliner 内部用的是 @xenova/transformers（node_modules/gliner/dist/index.mjs 首行
    // `import { env, AutoTokenizer } from '@xenova/transformers'`），tokenizer/config 由它下载，
    // 所以必须改它的 env。改 @huggingface/transformers 的 env 对这里的下载完全无效
    // （其默认 remoteHost 仍是 https://huggingface.co/，国内直连不稳定）。
    const transformers = await import('@xenova/transformers')
    transformers.env.remoteHost = 'https://modelscope.cn/'
    transformers.env.remotePathTemplate = 'models/{model}/resolve/{revision}/'
    transformers.env.allowLocalModels = false
    transformers.env.useBrowserCache = true

    // 流式下载模型，报告真实进度（源不可用时逐个回退）
    const response = await fetchFirstOk(MODEL_SOURCES)
    const contentLength = Number(response.headers.get('content-length')) || 0
    const reader = response.body?.getReader()

    let modelBuffer: ArrayBuffer
    if (reader && contentLength > 0) {
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        onProgress?.(Math.min(99, Math.round((received / contentLength) * 100)))
      }
      modelBuffer = new Uint8Array(received).buffer
      let offset = 0
      for (const chunk of chunks) {
        new Uint8Array(modelBuffer).set(chunk, offset)
        offset += chunk.length
      }
    } else {
      // 无法获取 Content-Length 时退化为不定进度
      onProgress?.(-1)
      modelBuffer = await response.arrayBuffer()
    }

    const { Gliner } = await import('gliner')
    const ort = await import('onnxruntime-web')

    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false

    glinerInstance = new Gliner({
      tokenizerPath: 'onnx-community/gliner_small-v2',
      onnxSettings: {
        modelPath: modelBuffer,
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
    // 降噪：AI 增强为可选功能，失败仅警告（基础正则检测不受影响）
    console.warn('[PasteGuard] Failed to load content model (optional feature):', error)
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
    console.warn('[PasteGuard] Content detection failed:', error)
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
export const preloadContentModel = async (
  onProgress?: (percent: number) => void
): Promise<void> => {
  await loadContentModel(onProgress)
}
