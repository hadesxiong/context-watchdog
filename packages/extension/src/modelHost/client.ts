// 模型宿主的客户端（SW 侧）。
//
// 职责只有三件：把 offscreen 文档拉起来、在上面跑一个请求、在不需要时销毁它。
// 不持有模型、不做推理 —— 那是 host.ts 的事。
//
// Firefox 没有 chrome.offscreen：isModelHostSupported() 为 false，调用方回退到
// 侧栏内加载（现状）。**能力差异必须显式返回**，不能靠"调用失败再看"，否则
// Firefox 上每次开 AI 都会先抛一个异常。
import type { DetectionItem, ProfileConfig } from '@engine/types'
import {
  MODEL_HOST_CLOSED_REASON,
  MODEL_HOST_PORT,
  MODEL_HOST_STATE_KEY,
  MODEL_HOST_URL,
  isModelHostNotice,
  isModelHostReply,
  type ModelHostReply,
  type ModelHostRequest
} from './protocol'

interface OffscreenApi {
  hasDocument?: () => Promise<boolean>
  createDocument?: (options: {
    url: string
    reasons: string[]
    justification: string
  }) => Promise<void>
  closeDocument?: () => Promise<void>
}

const offscreen = (): OffscreenApi | undefined =>
  (chrome as unknown as { offscreen?: OffscreenApi }).offscreen

/** Chrome / Edge 为 true，Firefox 为 false */
export const isModelHostSupported = (): boolean => typeof offscreen()?.createDocument === 'function'

// ---------- Port 连接 ----------

let hostPort: chrome.runtime.Port | null = null
const portWaiters: Array<(port: chrome.runtime.Port) => void> = []
const pending = new Map<string, (reply: ModelHostReply) => void>()

/** SW 的 onConnect 转交给这里。非宿主端口直接忽略。 */
export const attachModelHostPort = (port: chrome.runtime.Port): void => {
  if (port.name !== MODEL_HOST_PORT) return

  hostPort = port
  port.onMessage.addListener((message: unknown) => {
    // 宿主没有 storage API，状态在这里代写（键与 S2 面板订阅的一致）
    if (isModelHostNotice(message)) {
      void chrome.storage.session
        .set({ [MODEL_HOST_STATE_KEY]: message.state })
        .catch(() => undefined)
      return
    }
    if (!isModelHostReply(message)) return
    const resolve = pending.get(message.token)
    if (!resolve) return
    pending.delete(message.token)
    resolve(message)
  })

  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError
    if (hostPort === port) hostPort = null
    // 宿主没了，所有在途请求都不会有回包 —— 立刻失败，别让调用方等到超时
    failPending('模型宿主连接已断开')
  })

  // 唤醒等待者（createDocument 之后文档才连上来）
  for (const resolve of portWaiters.splice(0)) resolve(port)
}

// 主动关闭期间，所有在途请求的失败原因统一标成「已关闭」：
// 调用方（SW）据此知道这不是故障，不该往 storage.session 写 error 状态。
let closing = false

const failPending = (error: string): void => {
  const reason = closing ? MODEL_HOST_CLOSED_REASON : error
  for (const [token, resolve] of pending) {
    pending.delete(token)
    resolve({ token, ok: false, error: reason })
  }
}

const waitForPort = (timeoutMs: number): Promise<chrome.runtime.Port | null> => {
  if (hostPort) return Promise.resolve(hostPort)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      const index = portWaiters.indexOf(onPort)
      if (index >= 0) portWaiters.splice(index, 1)
      resolve(null)
    }, timeoutMs)
    const onPort = (port: chrome.runtime.Port): void => {
      clearTimeout(timer)
      resolve(port)
    }
    portWaiters.push(onPort)
  })
}

const nextToken = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 发一个请求并等回包。
 * timeoutMs = 0 表示**不超时**（ENSURE 首次要下载 349MB，任何固定超时都会误杀）。
 */
const send = (port: chrome.runtime.Port, request: ModelHostRequest, timeoutMs: number): Promise<ModelHostReply> =>
  new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (reply: ModelHostReply): void => {
      if (timer) clearTimeout(timer)
      pending.delete(request.token)
      resolve(reply)
    }

    pending.set(request.token, settle)
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        settle({ token: request.token, ok: false, error: 'timeout' })
      }, timeoutMs)
    }

    try {
      port.postMessage(request)
    } catch (error) {
      settle({
        token: request.token,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

// ---------- 对外 API ----------

export interface EnsureResult {
  ok: boolean
  /** false = 当前浏览器没有 offscreen（Firefox），调用方应回退到本地宿主 */
  supported: boolean
  ready: boolean
  error?: string
}

// 单飞：并发调用（面板初始化 + 用户点重试 + 粘贴路径）只应创建一次文档、
// 只应发一次 ENSURE。SW 重启会丢这个 promise，但 hasDocument() 会兜住。
let ensuring: Promise<EnsureResult> | null = null

export const ensureModelHost = (): Promise<EnsureResult> => {
  // 重新加载 = 关闭意图结束
  closing = false
  if (!ensuring) {
    ensuring = doEnsure().finally(() => {
      ensuring = null
    })
  }
  return ensuring
}

const doEnsure = async (): Promise<EnsureResult> => {
  const api = offscreen()
  if (!api?.createDocument) return { ok: false, supported: false, ready: false }

  if (!(await api.hasDocument?.())) {
    try {
      await api.createDocument({
        url: MODEL_HOST_URL,
        // WORKERS：宿主内跑 WASM 编译/推理。当前 numThreads=1 不起 Worker，
        // 但用 WORKERS 是为将来切 proxy=true 时不至于再来改权限与理由。
        reasons: ['WORKERS'],
        justification: '在本机运行 GLiNER/onnxruntime 模型推理，避免占用 service worker 与页面主线程'
      })
    } catch (error) {
      // 并发 createDocument 会抛 "Only a single offscreen document may be created"；
      // 此时文档其实已经存在，复查后继续
      if (!(await api.hasDocument?.())) {
        return {
          ok: false,
          supported: true,
          ready: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }

  const port = await waitForPort(5000)
  if (!port) return { ok: false, supported: true, ready: false, error: '模型宿主未连接' }

  const reply = await send(port, { op: 'ENSURE', token: nextToken() }, 0)
  return { ok: reply.ok, supported: true, ready: reply.ready ?? false, error: reply.error }
}

/** 探测宿主是否在、模型是否就绪。宿主不在时返回 null（不创建文档）。 */
export const pingModelHost = async (timeoutMs = 2000): Promise<ModelHostReply | null> => {
  if (!isModelHostSupported()) return null
  if (!(await offscreen()?.hasDocument?.())) return null
  const port = await waitForPort(timeoutMs)
  if (!port) return null
  return send(port, { op: 'PING', token: nextToken() }, timeoutMs)
}

export interface HostDetection {
  sanitized: string
  count: number
  items: DetectionItem[]
}

/**
 * 经宿主跑一次完整检测（正则 + AI）。
 * 返回 null = 宿主不可用（未创建 / 未就绪），调用方保留正则结果。
 */
export const detectViaModelHost = async (
  text: string,
  profile?: ProfileConfig,
  timeoutMs = 30000
): Promise<HostDetection | null> => {
  if (!isModelHostSupported()) return null
  const port = hostPort ?? (await waitForPort(2000))
  if (!port) return null

  const reply = await send(port, { op: 'DETECT', token: nextToken(), text, profile }, timeoutMs)
  if (!reply.ok || typeof reply.sanitized !== 'string') return null
  return {
    sanitized: reply.sanitized,
    count: reply.count ?? reply.items?.length ?? 0,
    items: reply.items ?? []
  }
}

/** 销毁宿主文档。模型内存随之释放（文档内的引用没有单独的 unload 语义）。 */
export const closeModelHost = async (): Promise<void> => {
  closing = true
  const api = offscreen()
  if (!api?.closeDocument) return
  if (!(await api.hasDocument?.())) return
  await api.closeDocument()
  hostPort = null
  failPending('模型宿主已关闭')
  // 文档已销毁，状态快照不再成立：清掉 session，避免下次开机读到「ready」的幽灵
  try {
    await chrome.storage.session.remove(MODEL_HOST_STATE_KEY)
  } catch {
    // 清理失败不影响文档已销毁这一事实
  }
}

/** 读宿主持久化的状态（S1 用于验收；S2 面板订阅 onChanged） */
export const readModelHostState = async (): Promise<unknown> => {
  try {
    const stored = await chrome.storage.session.get(MODEL_HOST_STATE_KEY)
    return stored[MODEL_HOST_STATE_KEY] ?? null
  } catch {
    return null
  }
}
