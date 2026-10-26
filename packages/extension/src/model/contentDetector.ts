// 内容检测器 - 使用 GLiNER 检测密钥和敏感信息

import type { SceneType } from '@engine/detector/sceneDetector'
import { isPlausibleEntity } from '@engine/detector/entityShape'
import { type ContentEntity, type ModelProgress } from '@engine/detector/backend'
import { downloadModel, createSingleFlight } from './modelDownload'
import { isCjkDominant } from './languageGuard'

// 置信度阈值与实体分类已上移到引擎 backend.ts（AI 后端契约的一部分），此处再导出以免既有调用点与测试断链。
export {
  CONFIDENCE_THRESHOLDS,
  categorizeEntity,
  type ContentEntity,
  type EntityCategory
} from '@engine/detector/backend'

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

// GLiNER 模型单例
let glinerInstance: any = null
let ready = false
// 单飞门闩：加载进行中时重试/重复调用复用同一个 promise，修复「卡住后点重试立刻 resolve（假成功）」
const loadGate = createSingleFlight()

// 记录一次 JS 堆快照（实测内存峰值用）；performance.memory 为 Chromium 专有，其他环境静默跳过
const reportHeapSnapshot = (stage: string): void => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  if (!memory?.usedJSHeapSize) return
  console.log(`[ContextWatchdog] 内存快照（${stage}）：JS 堆 ${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB`)
}

    // 实际加载流程（loadGate 保证同一时刻只跑一份）；模型以 ArrayBuffer 传入（modelPath 支持二进制），故有真实字节进度
const runLoad = async (
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onDownloadStart?: () => void
): Promise<void> => {
  try {
    // tokenizer/config 由 gliner 内部的 @xenova/transformers 下载（node_modules/gliner/dist/index.mjs），
    // 必须改它的 env；改 @huggingface/transformers 的 env 完全无效。
    const transformers = await import('@xenova/transformers')
    transformers.env.remoteHost = 'https://modelscope.cn/'
    transformers.env.remotePathTemplate = 'models/{model}/resolve/{revision}/'
    transformers.env.allowLocalModels = false
    transformers.env.useBrowserCache = true

    // 下载模型（多源回退、断点续传、版本探测等细节见 modelDownload.ts）
    const modelBuffer = await downloadModel({ onProgress, onWaiting, onDownloadStart })
    reportHeapSnapshot('模型下载完成')

    const { Gliner } = await import('gliner')
    // 此处的 onnxruntime-web 必须与 gliner 内部同一实例（package.json 钉死 1.19.2、npm 去重），下面的
    // numThreads 才能作用到 gliner 的推理会话
    const ort = await import('onnxruntime-web')

    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false

    // gliner 会把 onnxSettings 原样留在实例上，内联传 modelBuffer 会让 183MB 引用会话期可达 → 峰值内存
    // 接近翻倍；持本地引用，等 ORT 拷进 wasm 堆后再断开
    const onnxSettings: {
      modelPath: string | ArrayBufferLike
      executionProvider: 'wasm'
      multiThread: false
      // 空对象 = 走本地打包资产：gliner 默认把 wasmPaths 指向 jsdelivr CDN（离线必挂、包内 11MB wasm 成
      // 死重）；传空对象（非 undefined）绕过后 ort 视同「不覆盖」，emscripten 回落本地（spec.md §7）。
      wasmPaths: Record<string, never>
    } = {
      modelPath: modelBuffer,
      executionProvider: 'wasm',
      multiThread: false,
      wasmPaths: {}
    }

    glinerInstance = new Gliner({
      // 纯英文骨干（deberta-v3-small）：对中文全盲，中文片段由 languageGuard 在级联入口跳过（spec.md §13-3）
      tokenizerPath: 'onnx-community/gliner_small-v2',
      onnxSettings,
      transformersSettings: {
        allowLocalModels: false,
        useBrowserCache: true
      },
      // maxWidth 必须为 12：该 ONNX 导出把宽度常量烘焙死（gliner_config.json max_width: 12，Reshape 目标
      // [batch, num_words, 12, hidden]），≠12 必报 Reshape 失败、级联静默归零；>12 词跨度被截断是固有限制。
      maxWidth: 12,
      // 关键：gliner@0.0.19 只认 "span-level"（index.mjs:691），传其他值会走 TokenModel → 必报
      // `input 'span_idx' is missing in 'feeds'`、级联静默归零。
      modelType: 'span-level'
    })

    await glinerInstance.initialize()

    // 释放 JS 侧 183MB 模型引用（ORT session 已持有 wasm 堆副本，推理不受影响）
    onnxSettings.modelPath = ''
    reportHeapSnapshot('初始化完成并释放模型引用')

    ready = true
    console.log('[ContextWatchdog] Content detector ready')
  } catch (error) {
    // 降噪：AI 增强为可选功能，失败仅警告（基础正则检测不受影响）
    console.warn('[ContextWatchdog] Failed to load content model (optional feature):', error)
    throw error
  } finally {
    onWaiting?.(false)
  }
}

// 加载 GLiNER 模型。onProgress 真实下载进度（percent < 0 = 未知总长）；onWaiting 另一窗口在下载；onDownloadStart 确认走网络才触发
export const loadContentModel = (
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onDownloadStart?: () => void
): Promise<void> => {
  if (ready) return Promise.resolve()
  return loadGate.run(() => runLoad(onProgress, onWaiting, onDownloadStart))
}

// 检测内容实体；labels 为零样本标签集（由 Profile 提供，级联只送未被正则覆盖的片段）
export const detectContent = async (
  text: string,
  scene: SceneType,
  labels: string[] = SECRET_LABELS
): Promise<ContentEntity[]> => {
  if (!ready || !glinerInstance) {
    return []
  }

  // 当前模型对中文全盲（见 languageGuard.ts）：中文占优片段跳过 AI、退化为纯正则，喂中文只会产出幻觉
  if (isCjkDominant(text)) {
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

    const raw: ContentEntity[] = results[0].map((e: any) => ({
      text: e.spanText,
      startIndex: e.start,
      endIndex: e.end,
      entityType: e.label,
      confidence: e.score,
      scene
    }))

    // 形状门禁：不形似其标签的检出视为幻觉直接丢弃（entityShape.ts），否则会经 uncertain 低置信保留路径变成错误替换
    const kept: ContentEntity[] = []
    const dropped: string[] = []
    for (const e of raw) {
      if (isPlausibleEntity(e.text, e.entityType)) kept.push(e)
      else dropped.push(`${e.entityType} "${e.text}" (${e.confidence.toFixed(2)})`)
    }
    if (dropped.length > 0) {
      console.log('[ContextWatchdog] Dropped', dropped.length, 'implausible model entities:', dropped.join('; '))
    }
    return kept
  } catch (error) {
    console.warn('[ContextWatchdog] Content detection failed:', error)
    return []
  }
}

export const isContentModelReady = (): boolean => ready

export const preloadContentModel = async (
  onProgress?: ModelProgress,
  onWaiting?: (waiting: boolean) => void,
  onDownloadStart?: () => void
): Promise<void> => {
  await loadContentModel(onProgress, onWaiting, onDownloadStart)
}
