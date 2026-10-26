// offscreen 模型宿主（Chrome / Edge 唯一的模型运行时；offscreen 文档全局仅一个、已被本模块占用，
// 见 docs/site-ai-offscreen-host.md §10）。GLiNER + onnxruntime-web 是文档级单例，SW 不能加载 WASM
// 也会被随时终止；没有 UNLOAD，真正有效的释放是销毁文档。失败语义：ENSURE 失败只写状态 + 回包，正则档继续可用。
import { detect } from '@engine/detector'
import { getProfileById, DEFAULT_PROFILE_ID } from '@engine/detector/profiles'
import { sanitizeWithProfile } from '@engine/replacer'
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

// 占位符语言：offscreen 文档没有 chrome.i18n（只有 chrome.runtime），只能用 navigator.language；与 SW 侧按浏览器语言定的取舍一致，区别只在数据源。
setPlaceholderLocale(navigator.language.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en')

let state = initialModelHostState(Date.now())
let lastPostAt = 0

/**
 * 状态上报。offscreen 里**没有 chrome.storage**，只能发给 SW，由它写 storage.session
 *（面板订阅那一份）。进度按下载块来，故 1s 节流；相位变化（ready / error / waiting）
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
    // SW 被浏览器回收后会自动重启；宿主不必重启，重连即可
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
    // 首次 ENSURE 可能持续数分钟（下载 183MB），进度经 storage.session 暴露，故刻意不设超时。
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
    // 按档案默认策略脱敏（与 SW 正则首答同一规则）：判定「保留」的项原样留下，不能无条件替换全部识别项。
    const profile = request.profile ?? getProfileById(DEFAULT_PROFILE_ID)
    const { sanitizedText } = sanitizeWithProfile(result.text, result.items, profile)
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
