// 内容检测器 - 使用 GLiNER 检测密钥和敏感信息

import type { SceneType } from '@engine/detector/sceneDetector'
import { isPlausibleEntity } from '@engine/detector/entityShape'
import { type ContentEntity, type ModelProgress } from '@engine/detector/backend'
import { downloadModel, createSingleFlight } from './modelDownload'

// 置信度阈值、ContentEntity、EntityCategory、categorizeEntity 已上移到引擎的
// backend.ts（它们是 AI 后端契约的一部分，检测管线直接消费）。此处保留再导出，
// 避免既有调用点与测试断链。
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
// 单飞门闩：加载进行中时，重试/重复调用复用同一个 promise（结果就是真实结果，
// 修复「卡住后点重试立刻 resolve（假成功）／永久卡 loading」）
const loadGate = createSingleFlight()

// 记录一次 JS 堆快照（用于实测内存峰值，见 TODO 遗留项 A-4）。
// performance.memory 为 Chromium 专有且已废弃但仍可用；其他环境静默跳过
const reportHeapSnapshot = (stage: string): void => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  if (!memory?.usedJSHeapSize) return
  console.log(`[ContextWatchdog] 内存快照（${stage}）：JS 堆 ${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB`)
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
    // 此处的 onnxruntime-web 必须与 gliner 内部用的是同一实例：package.json 已将其钉死
    // 1.19.2（与 gliner@0.0.19 的依赖精确一致），npm 去重后单实例，下面的 numThreads
    // 才能作用到 gliner 的推理会话；否则两份 ort 共存，wasm 资产与线程配置各管各的
    const ort = await import('onnxruntime-web')

    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false

    // gliner 会把 onnxSettings 原样留在实例上（gliner/src/web/ONNXWebWrapper.ts:61 用 settings.modelPath 建会话），
    // 内联传 modelBuffer 会让 580MB 引用在整个会话期可达 → 峰值内存接近翻倍。
    // 这里持本地引用，等 ORT 把数据拷进 wasm 堆后再断开（见下方释放）
    const onnxSettings: {
      modelPath: string | ArrayBufferLike
      executionProvider: 'wasm'
      multiThread: false
      // 空对象 = 让 wasm 走本地打包资产。gliner 默认把 env.wasm.wasmPaths 设为
      // jsdelivr CDN（index.mjs:615）——CDN 拉 wasm：离线推理必挂，且包内已发出的
      // 11MB ort-wasm-simd-threaded.wasm 成了死重。传空对象（非 undefined，绕过其
      // 默认值）后 ort 门面视同「不覆盖」：locateFile 不设置，emscripten 回落到
      // 构建时已改写的本地资产 URL；胶水加载器 zp 忽略参数恒用打包内模块（1.19.2 实证）。
      // 配合 contentDetector 的 numThreads=1（单实例，已生效）无 worker 拉取需求。
      wasmPaths: Record<string, never>
    } = {
      modelPath: modelBuffer,
      executionProvider: 'wasm',
      multiThread: false,
      wasmPaths: {}
    }

    glinerInstance = new Gliner({
      // 多语言骨干（mdeberta-v3-base，中文在词表内）——中文姓名/地址可被检出的前提。
      // 前代 gliner_small-v2 为纯英文 deberta-v3-small，中文全塌缩为 [UNK] → 召回为零，
      // 换模根因与代价见 modelDownload.ts 头部与 spec §13-3
      tokenizerPath: 'onnx-community/gliner_multi-v2.1',
      onnxSettings,
      transformersSettings: {
        allowLocalModels: false,
        useBrowserCache: true
      },
      // 模型导出宽度约束（曾为「长连接串/长 PII 不切块」将默认 12 提到 256，真机推理即崩）：
      // onnx-community/gliner_multi-v2.1（及前代 small-v2）的 ONNX 导出把 span_rep_layer 的
      // 宽度常量烘焙死为 12（gliner_config.json 的 max_width: 12；Reshape 目标
      // [batch, num_words, 12, hidden]），maxWidth≠12 时 span 行数（num_words × maxWidth）
      // 对不上必报 Reshape 失败——浏览器里表现为裸数字错误
      // （ORT 的 OrtStatus 指针未透出消息），AI 级联静默归零。超过 12 词的跨度会被截到
      // 12 词窗口，这是该导出的固有限制（中文逐字成词，姓名/地址/手机号远短于 12 词，不受影响）。
      maxWidth: 12,
      // 关键：gliner@0.0.19 只认 "span-level"（index.mjs:691 分支），传其他值会走
      // TokenModel（只喂 input_ids/attention_mask/words_mask/text_lengths），
      // 而 onnx-community/gliner_small-v2 是 span-level 模型（图声明 span_idx 输入），
      // 推理必报 `input 'span_idx' is missing in 'feeds'` → AI 级联静默归零。
      // 原值 'gliner' 系沿用 HF 仓库 config 的 model_type 命名，与本包分支约定不符。
      modelType: 'span-level'
    })

    await glinerInstance.initialize()

    // 释放 JS 侧 580MB 模型引用（ORT session 已持有 wasm 堆副本，推理不受影响）
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

    const raw: ContentEntity[] = results[0].map((e: any) => ({
      text: e.spanText,
      startIndex: e.start,
      endIndex: e.end,
      entityType: e.label,
      confidence: e.score,
      scene
    }))

    // 形状门禁：不形似其标签的模型检出视为幻觉直接丢弃（entityShape.ts）。
    // 实机例：中文幻觉「户」→ person name 0.456、「订」→ email 0.330，
    // 不拦会经 uncertain 低置信保留路径变成错误替换
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

// 分类实体 → 已上移到 @engine/detector/backend（见文件顶部再导出）

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
