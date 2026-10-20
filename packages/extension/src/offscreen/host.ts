// offscreen 模型宿主（Chrome / Edge 下唯一的模型运行时）。
//
// 为什么要有这个文档：GLiNER + onnxruntime-web 是模块级单例，只能在**文档**里跑；
// service worker 里既不能加载 WASM，也会被浏览器随时终止。offscreen 文档有独立
// 进程、没有 SW 的 30s 限制、且全局只允许一个 —— 正好当"唯一模型宿主"。
//
// 生命周期：
//   SW createDocument → 本文件执行 → 连 Port → 等 ENSURE
//   SW closeDocument  → 整个文档销毁（内存随之释放）
// 所以这里**没有 UNLOAD 操作**：在文档内部释放到不了"进程消失"的程度，真正有效的
// 释放就是销毁文档本身。S2 的"关闭全局 AI"直接调 closeDocument 即可。
//
// 失败语义：ENSURE 失败只写状态 + 回包，不抛到控制台顶层 —— AI 是可选能力，
// 正则档必须继续可用。
import { detect } from '@engine/detector'
import { sanitizeText } from '@engine/replacer'
import { setPlaceholderLocale } from '@engine/replacer/placeholder'
import { isContentModelReady, preloadModels } from '@/model'
import {
  MODEL_HOST_PORT,
  isModelHostRequest,
  type ModelHostNotice,
  type ModelHostReply,
  type ModelHostRequest
} from '@/modelHost/protocol'
import {
  initialModelHostState,
  withDownloadStarted,
  withError,
  withProgress,
  withReady,
  withWaiting,
  type ModelHostState
} from '@/modelHost/state'

// 占位符语言：offscreen 文档**没有 chrome.i18n**（实测只有 chrome.runtime），
// 因此只能用 navigator.language。这与 SW 侧按浏览器语言定占位符语言的取舍一致，
// 区别只在数据源。
setPlaceholderLocale(navigator.language.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en')

let state = initialModelHostState(Date.now())
let lastPostAt = 0

/**
 * 状态上报。offscreen 里**没有 chrome.storage**，所以只能把状态发给 SW，由它写
 * storage.session（S2 的面板订阅那一份）。
 *
 * 进度回调是按下载块来的，因此按 1s 节流；相位变化（ready / error / waiting）
 * 强制发，避免"卡在 99%"。
 */
const publish = (next: ModelHostState, force = false): void => {
  state = next
  const now = Date.now()
  if (!force && now - lastPostAt < 1000) return
  lastPostAt = now
  try {
    port?.postMessage({ op: 'STATUS', state } satisfies ModelHostNotice)
  } catch {
    // 端口已断开：状态丢失无妨，SW 重连后 PING 会拿到真实就绪状态
  }
}

// ---------- Port ----------

let port: chrome.runtime.Port | null = null

const reply = (message: ModelHostReply): void => {
  try {
    port?.postMessage(message)
  } catch {
    // 端口已断开（SW 正在重启）：回包丢失是协议内可接受的，调用方会超时降级
  }
}

const connect = (): void => {
  try {
    port = chrome.runtime.connect({ name: MODEL_HOST_PORT })
  } catch (error) {
    // 文档正在销毁时 connect 会抛；此时重连没有意义
    console.warn('[ContextWatchdog] 模型宿主连接 SW 失败:', error)
    return
  }

  port.onMessage.addListener((message: unknown) => {
    if (!isModelHostRequest(message)) return
    void handle(message)
  })

  port.onDisconnect.addListener(() => {
    // 读取 lastError 以抑制 "Unchecked runtime.lastError" 噪音
    void chrome.runtime.lastError
    port = null
    // SW 被浏览器回收后会自动重启；宿主不必重启，重连即可（设计文档 §5）
    setTimeout(connect, 500)
  })
}

// ---------- 请求处理 ----------

const ensure = async (token: string): Promise<void> => {
  if (isContentModelReady()) {
    reply({ token, ok: true, ready: true })
    return
  }

  try {
    // 首次 ENSURE 可能持续数分钟（下载 183MB）；进度通过 storage.session 暴露，
    // 因此这里刻意不设超时。
    await preloadModels(
      (percent, received, total) => {
        publish(withProgress(state, percent, received, total, Date.now()))
      },
      waiting => {
        publish(withWaiting(state, waiting, Date.now()), true)
      },
      () => {
        publish(withDownloadStarted(state, Date.now()), true)
      }
    )
    publish(withReady(state, Date.now()), true)
    reply({ token, ok: true, ready: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publish(withError(state, message, Date.now()), true)
    console.warn('[ContextWatchdog] 模型宿主加载失败（AI 可选，正则档不受影响）:', error)
    reply({ token, ok: false, ready: false, error: message })
  }
}

const runDetect = async (request: Extract<ModelHostRequest, { op: 'DETECT' }>): Promise<void> => {
  if (!isContentModelReady()) {
    // 明确回"未就绪"，而不是把原文当成脱敏结果 —— 调用方据此保留正则结果
    reply({ token: request.token, ok: false, ready: false, error: 'model-not-ready' })
    return
  }

  try {
    const result = await detect(request.text, request.profile, { enableContentDetection: true })
    const { sanitizedText } = sanitizeText(result.text, result.items)
    reply({
      token: request.token,
      ok: true,
      ready: true,
      sanitized: sanitizedText,
      count: result.items.length,
      items: result.items
    })
  } catch (error) {
    reply({
      token: request.token,
      ok: false,
      ready: true,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

const handle = async (request: ModelHostRequest): Promise<void> => {
  switch (request.op) {
    case 'PING':
      reply({ token: request.token, ok: true, ready: isContentModelReady() })
      return
    case 'ENSURE':
      await ensure(request.token)
      return
    case 'DETECT':
      await runDetect(request)
      return
  }
}

connect()
publish(state, true)
