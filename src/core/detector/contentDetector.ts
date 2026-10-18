// 内容检测器 - 使用 GLiNER 检测密钥和敏感信息

import type { SceneType } from './sceneDetector'
import { downloadModel, createSingleFlight, type ModelProgress } from './modelDownload'

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
let ready = false
// 单飞门闩：加载进行中时，重试/重复调用复用同一个 promise（结果就是真实结果，
// 修复「卡住后点重试立刻 resolve（假成功）／永久卡 loading」）
const loadGate = createSingleFlight()

// 记录一次 JS 堆快照（用于实测内存峰值，见 TODO 遗留项 A-4）。
// performance.memory 为 Chromium 专有且已废弃但仍可用；其他环境静默跳过
const reportHeapSnapshot = (stage: string): void => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  if (!memory?.usedJSHeapSize) return
  console.log(`[PasteGuard] 内存快照（${stage}）：JS 堆 ${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB`)
}

// 实际加载流程（由 loadGate 保证同一时刻只跑一份）
// 模型以 ArrayBuffer 传入 gliner（其 modelPath 支持二进制），因此能拿到真实字节进度
const runLoad = async (
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onDownloadStart?: () => void
): Promise<void> => {
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

    // 下载模型：多源回退 + 会话内/跨会话断点续传 + 退避重试 + 停滞看门狗 + Cache Storage 落盘
    // + 多窗口去重 + 缓存版本自动探测，细节见 modelDownload.ts
    const modelBuffer = await downloadModel({ onProgress, onWaiting, onDownloadStart })
    reportHeapSnapshot('模型下载完成')

    const { Gliner } = await import('gliner')
    const ort = await import('onnxruntime-web')

    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false

    // gliner 会把 onnxSettings 原样留在实例上（gliner/src/web/ONNXWebWrapper.ts:61 用 settings.modelPath 建会话），
    // 内联传 modelBuffer 会让 183MB 引用在整个会话期可达 → 峰值内存接近翻倍。
    // 这里持本地引用，等 ORT 把数据拷进 wasm 堆后再断开（见下方释放）
    const onnxSettings: {
      modelPath: string | ArrayBufferLike
      executionProvider: 'wasm'
      multiThread: false
    } = {
      modelPath: modelBuffer,
      executionProvider: 'wasm',
      multiThread: false
    }

    glinerInstance = new Gliner({
      tokenizerPath: 'onnx-community/gliner_small-v2',
      onnxSettings,
      transformersSettings: {
        allowLocalModels: false,
        useBrowserCache: true
      },
      // Phase 2: 12 → 256，长连接串/长 PII 不再被切成多个块
      maxWidth: 256,
      // 关键：gliner@0.0.19 只认 "span-level"（index.mjs:691 分支），传其他值会走
      // TokenModel（只喂 input_ids/attention_mask/words_mask/text_lengths），
      // 而 onnx-community/gliner_small-v2 是 span-level 模型（图声明 span_idx 输入），
      // 推理必报 `input 'span_idx' is missing in 'feeds'` → AI 级联静默归零。
      // 原值 'gliner' 系沿用 HF 仓库 config 的 model_type 命名，与本包分支约定不符。
      modelType: 'span-level'
    })

    await glinerInstance.initialize()

    // 释放 JS 侧 183MB 模型引用（ORT session 已持有 wasm 堆副本，推理不受影响）
    onnxSettings.modelPath = ''
    reportHeapSnapshot('初始化完成并释放模型引用')

    ready = true
    console.log('[PasteGuard] Content detector ready')
  } catch (error) {
    // 降噪：AI 增强为可选功能，失败仅警告（基础正则检测不受影响）
    console.warn('[PasteGuard] Failed to load content model (optional feature):', error)
    throw error
  } finally {
    onWaiting?.(false)
  }
}

// 加载 GLiNER 模型
// onProgress: 真实下载进度（percent < 0 表示未知总长；received/total 供 UI 展示 MB）
// onWaiting: 另一窗口正在下载，本窗口处于等待状态（UI 据此显示「另一窗口下载中」）
// onDownloadStart: 确认走网络下载才触发（缓存命中全程静默，仅控制台日志）
export const loadContentModel = (
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onDownloadStart?: () => void
): Promise<void> => {
  if (ready) return Promise.resolve()
  return loadGate.run(() => runLoad(onProgress, onWaiting, onDownloadStart))
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
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onDownloadStart?: () => void
): Promise<void> => {
  await loadContentModel(onProgress, onWaiting, onDownloadStart)
}
