// GLiNER 模型下载器
// 职责：多源回退 → Range 断点续传（会话内 + 跨会话）→ 指数退避重试（尊重 Retry-After）→
//       停滞看门狗 → 传输完整性校验 → Cache Storage 落盘 → 多窗口去重（storage 锁）→
//       缓存版本自动失效（1 字节探测）
// 独立成模块的原因：fetch / cache / partial / lock / sleep 全部可注入，便于在 node 环境下单测
// （见 tests/unit/modelDownload.test.ts）

import type { ModelProgress } from '@engine/detector/backend'

// 下载进度回调：percent < 0 表示未知总长（UI 走不定进度动画）；received/total 供 UI 展示 MB
// 契约定义在引擎的 backend.ts（检测管线的 preload 也用同一个类型），此处再导出供调用点直接取用
export type { ModelProgress } from '@engine/detector/backend'

// 注意：模型文件在 onnx/ 子目录下（仓库根目录没有 model.onnx，直接请求会 404）。
// 选 model_quantized.onnx（int8 量化，约 183MB / 183,403,734 字节）：全量 model.onnx 达 611MB，不适合浏览器扩展
//
// 模型源（按顺序轮换）：
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
export const MODEL_SOURCES = [
  'https://modelscope.cn/models/onnx-community/gliner_small-v2/resolve/main/onnx/model_quantized.onnx',
  'https://huggingface.co/onnx-community/gliner_small-v2/resolve/main/onnx/model_quantized.onnx'
]

// 当前模型文件字节数：只作"期望大小"的文档参考，不再用作缓存版本号
// （缓存是否失效改由 1 字节探测三级比对 ETag / Last-Modified / 长度自动决定，见 probeRemoteVersion）
export const MODEL_FILE_BYTES = 183403734

export const MODEL_CACHE_NAME = 'contextwatchdog-models'
// 缓存 key 固定（合成 URL，.invalid 永不解析、不参与网络请求）；
// 版本信息（ETag / Last-Modified / 长度 / 时间）存进条目的响应头，由探测结果决定是否作废
export const MODEL_CACHE_URL = 'https://contextwatchdog.invalid/models/gliner_small-v2/model_quantized.onnx'
// 未完成下载的部分文件（跨会话断点续传的落点）
export const MODEL_PARTIAL_URL = `${MODEL_CACHE_URL}?partial`
// 旧版缓存 key（带 ?v= 字节数）：命中时一次性搬迁，避免升级用户重下 183MB
export const LEGACY_MODEL_CACHE_URL = `${MODEL_CACHE_URL}?v=${MODEL_FILE_BYTES}`

export const MAX_ATTEMPTS = 5
// 单次尝试的停滞看门狗：这么久没收到任何字节就中断本次连接，下次从断点续传
export const STALL_TIMEOUT_MS = 30_000
export const RETRY_BASE_DELAY_MS = 1_000
export const RETRY_MAX_DELAY_MS = 16_000
// 版本探测的超时（1 字节请求，给足但别拖慢启动）
export const PROBE_TIMEOUT_MS = 5_000
// 版本探测节流窗口：距上次成功探测不足该时长直接沿用缓存（跨标签共享计时，
// 存 chrome.storage.local）。模型极少更新，换取每次打开零探测延迟；
// 离线（navigator.onLine === false）则完全跳过探测，不再白等超时
export const PROBE_THROTTLE_MS = 24 * 60 * 60 * 1000
// 探测时间戳的持久化 key（两个标签页/侧栏共享，24h 内只探一次）
export const PROBE_STAMP_KEY = 'contextwatchdog.lastModelProbe'

// 多窗口去重：锁键 + 心跳 TTL + 等待方轮询节奏（默认 1.5s × 200 轮 ≈ 5 分钟）
export const MODEL_LOCK_KEY = 'contextwatchdog.modelLock'
export const MODEL_LOCK_TTL_MS = 30_000
export const LOCK_POLL_MS = 1_500
export const LOCK_WAIT_ROUNDS = 200
// 进度心跳写锁的最小间隔（避免每块字节都写一次 chrome.storage）
export const HEARTBEAT_THROTTLE_MS = 1_000

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

// 丢弃不需要的响应正文（释放连接）；body 缺失/已锁定时静默忽略
const discardBody = (response: Response): void => {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    // 忽略
  }
}

// ---------- 数据结构 ----------

// 远端当前版本（来自 1 字节探测）
export interface RemoteVersion {
  etag: string | null
  // Last-Modified：CORS 安全列表头（浏览器恒可见）；ModelScope CDN 不暴露
  // Access-Control-Expose-Headers → 浏览器里 ETag/Content-Range 恒为 null，靠它比对版本
  lastModified?: string | null
  total: number
  source: string
}

// 本地完整缓存条目
export interface CachedModel {
  buffer: ArrayBuffer
  etag: string | null
  // 下载时远端的 Last-Modified（安全列表头，浏览器里读得到也存得下）
  lastModified?: string | null
  total: number
  savedAt: number
  // 下载自哪个源（host）：跨源比对 ETag 必然不一致（各源自行生成），须退回比总长
  source: string | null
}

// 未完成下载（部分文件）的元数据，随条目存在响应头里
export interface PartialModelMeta {
  total: number
  etag: string | null
  source: string | null
  // 续传完成后写入完整条目时保住版本身份（旧部分文件无此字段 → 缺席，比对自然降级）
  lastModified?: string | null
  savedAt: number
}

export interface PartialStore {
  load: () => Promise<{ buffer: ArrayBuffer; meta: PartialModelMeta } | null>
  save: (buffer: ArrayBuffer, meta: PartialModelMeta) => Promise<void>
  clear: () => Promise<void>
}

export interface ModelCache {
  match: () => Promise<CachedModel | null>
  put: (
    buffer: ArrayBuffer,
    meta?: { etag?: string | null; source?: string | null; lastModified?: string | null }
  ) => Promise<void>
  clear: () => Promise<void>
  // 旧版 key 一次性迁移；返回是否发生了迁移
  migrateLegacy?: () => Promise<boolean>
}

// 多窗口下载锁状态（持久化在 chrome.storage.local）
export interface ModelLockState {
  owner: string
  expiresAt: number
  percent: number
  received: number
  total: number
}

export interface DownloadLock {
  // 抢锁：成功 true；他人持有且未过期 false
  tryAcquire: () => Promise<boolean>
  // 刷新心跳与进度；返回 false 表示锁已丢失（被接管/清除）
  heartbeat: (progress: { percent: number; received: number; total: number }) => Promise<boolean>
  // 读取当前锁状态（含他人进度）；无锁返回 null
  read: () => Promise<ModelLockState | null>
  release: () => Promise<void>
}

export interface ProbeOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  sources?: string[]
  timeoutMs?: number
}

// ---------- 纯函数（单测覆盖） ----------

// 解析 `Content-Ranges: bytes 100-199/1234` → { start, total }；total 为 0 表示未知（`*`）
export const parseContentRange = (value: string | null): { start: number; total: number } | null => {
  if (!value) return null
  const matched = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim())
  if (!matched) return null
  return {
    start: Number(matched[1]),
    total: matched[3] === '*' ? 0 : Number(matched[3])
  }
}

// 解析 Retry-After：纯数字为秒数，否则按 HTTP-date 折算成秒（已过期返回 0）
export const parseRetryAfter = (value: string | null): number | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

// 指数退避（retryIndex 从 1 开始）；服务端给了 Retry-After 时以其为准（仍封顶，避免长等）
export const backoffDelayMs = (retryIndex: number, retryAfterSeconds?: number | null): number => {
  if (retryAfterSeconds != null) {
    return Math.min(Math.max(retryAfterSeconds * 1000, RETRY_BASE_DELAY_MS), RETRY_MAX_DELAY_MS)
  }
  const exponential = RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryIndex - 1)
  return Math.min(exponential, RETRY_MAX_DELAY_MS)
}

// 下载进度：有总长按百分比（封顶 99，收满后由调用方报 100），无总长返回 -1
export const progressPercent = (received: number, total: number): number =>
  total > 0 ? Math.min(99, Math.round((received / total) * 100)) : -1

// 分片拼接；total 缺省时按各分片长度求和，长度对不上视为数据损坏
export const mergeChunks = (chunks: Uint8Array[], total?: number): ArrayBuffer => {
  const expected = total && total > 0 ? total : chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(expected)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  if (offset !== expected) {
    throw new Error(`模型数据不完整：${offset}/${expected} 字节`)
  }
  return out.buffer as ArrayBuffer
}

// 弱校验 ETag（`W/` 开头）按 RFC 7233 不能用于 If-Range，此时跳过该头、只靠总长兜底
export const isWeakEtag = (etag: string | null): boolean => !etag || etag.trim().startsWith('W/')

// 本地缓存与远端版本比对：'stale' 才需要重新下载；
// 探测失败（离线 / 被限流 / 超时）→ 'unknown' → 沿用缓存（离线优先）
// ⚠️ ETag / Last-Modified 只在同源（或任一侧来源未知）时才可比对：ModelScope 与
// HuggingFace 各自生成，跨源直接比对必然不一致 → 误判 'stale' → 清缓存重下 183MB。
// 跨源时退回比总字节数（两源对同一文件返回一致的 183,403,734 字节）
// ⚠️ 浏览器跨源读不到非安全列表头（Fetch 规范只放行 Cache-Control / Content-Language /
// Content-Length / Content-Type / Expires / Last-Modified / Pragma）：ModelScope CDN 不发
// Access-Control-Expose-Headers → JS 里 ETag / Content-Range 恒为 null。故三级比对：
// ETag → Last-Modified（安全列表头，恒可见）→ 总长；三级都无信息才 'unknown' → 沿用缓存。
export const compareCachedVersion = (
  cached: { etag: string | null; total: number; source?: string | null; lastModified?: string | null },
  remote: RemoteVersion | null
): 'current' | 'stale' | 'unknown' => {
  if (!remote) return 'unknown'
  const sameSource = !cached.source || !remote.source || cached.source === remote.source
  if (sameSource && cached.etag && remote.etag) return cached.etag === remote.etag ? 'current' : 'stale'
  if (sameSource && cached.lastModified && remote.lastModified)
    return cached.lastModified === remote.lastModified ? 'current' : 'stale'
  if (cached.total > 0 && remote.total > 0) return cached.total === remote.total ? 'current' : 'stale'
  return 'unknown'
}

// 探测节流判定：离线直接跳过（沿用缓存，省掉超时假等待）；
// 距上次成功探测不足 PROBE_THROTTLE_MS 也跳过（时间戳存 storage，跨标签共享）
export const shouldProbeRemote = (
  options: { online: boolean; lastProbeAt: number; now: number; throttleMs?: number }
): boolean => {
  if (!options.online) return false
  const throttleMs = options.throttleMs ?? PROBE_THROTTLE_MS
  return options.now - (options.lastProbeAt || 0) >= throttleMs
}

// ---------- Cache Storage：完整模型 ----------

const buildModelHeaders = (
  byteLength: number,
  etag?: string | null,
  source?: string | null,
  lastModified?: string | null
): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Length': String(byteLength),
    'Content-Type': 'application/octet-stream',
    'X-Model-Total': String(byteLength),
    'X-Model-Saved-At': String(Date.now())
  }
  if (etag) headers.ETag = etag
  // 记录下载来源（host）：版本探测跨源比对时据此只退回比总长，防止 ETag 误判清缓存
  if (source) headers['X-Model-Source'] = source
  // Last-Modified 是 CORS 安全列表头：浏览器里 ETag 读不到时靠它完成版本比对
  if (lastModified) headers['X-Model-Last-Modified'] = lastModified
  return headers
}

// 浏览器（扩展页）缓存实现；node/测试环境没有 caches 时返回 null（跳过缓存）
export const createBrowserModelCache = (): ModelCache | null => {
  if (typeof caches === 'undefined') return null
  return {
    match: async () => {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME)
        const response = await cache.match(MODEL_CACHE_URL)
        if (!response) return null
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength === 0) return null
        // 写入被中断会表现为声明长度与实际不符 → 作废重下
        const declared = Number(response.headers.get('content-length')) || 0
        if (declared > 0 && declared !== buffer.byteLength) return null
        return {
          buffer,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('x-model-last-modified'),
          total: Number(response.headers.get('x-model-total')) || buffer.byteLength,
          savedAt: Number(response.headers.get('x-model-saved-at')) || 0,
          source: response.headers.get('x-model-source')
        }
      } catch (error) {
        console.warn('[ContextWatchdog] 读取模型缓存失败（改为网络下载）:', error)
        return null
      }
    },
    put: async (buffer, meta) => {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME)
        await cache.put(
          MODEL_CACHE_URL,
          new Response(buffer, {
            headers: buildModelHeaders(buffer.byteLength, meta?.etag, meta?.source, meta?.lastModified)
          })
        )
        console.log(`[ContextWatchdog] 模型已写入缓存（${(buffer.byteLength / 1048576).toFixed(1)} MB），下次启动零下载`)
      } catch (error) {
        // 缓存失败不影响本次使用（下次再下一遍而已）
        console.warn('[ContextWatchdog] 写入模型缓存失败（不影响本次加载）:', error)
      }
    },
    clear: async () => {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME)
        await cache.delete(MODEL_CACHE_URL)
      } catch (error) {
        console.warn('[ContextWatchdog] 清除模型缓存失败:', error)
      }
    },
    migrateLegacy: async () => {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME)
        const legacy = await cache.match(LEGACY_MODEL_CACHE_URL)
        if (!legacy) return false
        const buffer = await legacy.arrayBuffer()
        await cache.delete(LEGACY_MODEL_CACHE_URL)
        if (buffer.byteLength === 0) return false
        await cache.put(MODEL_CACHE_URL, new Response(buffer, { headers: buildModelHeaders(buffer.byteLength) }))
        console.log('[ContextWatchdog] 已将旧版模型缓存迁移到新 key，无需重新下载')
        return true
      } catch (error) {
        console.warn('[ContextWatchdog] 迁移旧版模型缓存失败（将重新下载）:', error)
        return false
      }
    }
  }
}

// ---------- Cache Storage：未完成的部分文件（跨会话断点） ----------

export const createBrowserPartialStore = (): PartialStore | null => {
  if (typeof caches === 'undefined') return null
  const open = () => caches.open(MODEL_CACHE_NAME)
  return {
    load: async () => {
      try {
        const cache = await open()
        const response = await cache.match(MODEL_PARTIAL_URL)
        if (!response) return null
        const buffer = await response.arrayBuffer()
        const declared = Number(response.headers.get('content-length')) || 0
        const declaredBytes = Number(response.headers.get('x-model-bytes')) || 0
        // 三重一致性校验：写入被中断会表现为长度不符 → 丢弃重下，绝不拼出脏数据
        if (
          buffer.byteLength === 0 ||
          declaredBytes !== buffer.byteLength ||
          (declared > 0 && declared !== buffer.byteLength)
        ) {
          await cache.delete(MODEL_PARTIAL_URL)
          return null
        }
        return {
          buffer,
          meta: {
            total: Number(response.headers.get('x-model-total')) || 0,
            etag: response.headers.get('x-model-etag') || null,
            source: response.headers.get('x-model-source') || null,
            lastModified: response.headers.get('x-model-last-modified') || null,
            savedAt: Number(response.headers.get('x-model-saved-at')) || 0
          }
        }
      } catch (error) {
        console.warn('[ContextWatchdog] 读取未完成的下载进度失败（改为从头下载）:', error)
        return null
      }
    },
    save: async (buffer, meta) => {
      try {
        const cache = await open()
        await cache.put(
          MODEL_PARTIAL_URL,
          new Response(buffer, {
            headers: {
              ...buildModelHeaders(buffer.byteLength),
              'X-Model-Bytes': String(buffer.byteLength),
              'X-Model-Total': String(meta.total),
              'X-Model-Etag': meta.etag ?? '',
              'X-Model-Source': meta.source ?? '',
              'X-Model-Last-Modified': meta.lastModified ?? '',
              'X-Model-Saved-At': String(meta.savedAt)
            }
          })
        )
      } catch (error) {
        // 部分文件写失败只影响下次续传起点，不影响本次下载
        console.warn('[ContextWatchdog] 保存未完成的下载进度失败（不影响本次下载）:', error)
      }
    },
    clear: async () => {
      try {
        const cache = await open()
        await cache.delete(MODEL_PARTIAL_URL)
      } catch {
        // 忽略
      }
    }
  }
}

// ---------- 多窗口下载锁 ----------

// storage 为 null（node / 无 chrome.storage）时锁退化为"始终可抢"，逻辑不受影响
export const createModelLock = (
  storage: { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> } | null,
  options: { now?: () => number; ttlMs?: number } = {}
): DownloadLock => {
  const now = options.now ?? (() => Date.now())
  const ttlMs = options.ttlMs ?? MODEL_LOCK_TTL_MS
  const owner = `lock-${Math.random().toString(36).slice(2, 10)}-${now().toString(36)}`

  const read = async (): Promise<ModelLockState | null> => {
    if (!storage) return null
    const result = await storage.get(MODEL_LOCK_KEY)
    const raw = result[MODEL_LOCK_KEY]
    if (!raw || typeof raw !== 'object') return null
    const state = raw as Record<string, unknown>
    if (typeof state.owner !== 'string' || !state.owner) return null
    return {
      owner: state.owner,
      expiresAt: Number(state.expiresAt) || 0,
      percent: Number(state.percent) || 0,
      received: Number(state.received) || 0,
      total: Number(state.total) || 0
    }
  }

  return {
    read,
    tryAcquire: async () => {
      const state = await read()
      if (state && state.owner !== owner && state.expiresAt > now()) return false
      await storage?.set({ [MODEL_LOCK_KEY]: { owner, expiresAt: now() + ttlMs, percent: 0, received: 0, total: 0 } })
      return true
    },
    heartbeat: async progress => {
      const state = await read()
      if (!state || state.owner !== owner) return false
      await storage?.set({
        [MODEL_LOCK_KEY]: {
          owner,
          expiresAt: now() + ttlMs,
          percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
          received: progress.received,
          total: progress.total
        }
      })
      return true
    },
    release: async () => {
      const state = await read()
      if (state?.owner === owner) await storage?.set({ [MODEL_LOCK_KEY]: null })
    }
  }
}

// ---------- 单飞（single-flight） ----------

export interface SingleFlight {
  // 已有任务在跑时直接复用同一个 promise（忽略新任务函数），否则启动新任务
  run: <T>(fn: () => Promise<T>) => Promise<T>
  isRunning: () => boolean
}

// 用于修复「加载卡住后点重试立刻 resolve（假成功）／永久卡 loading」：
// 重试一律复用在飞的那次加载，其 resolve/reject 就是真实结果
export const createSingleFlight = (): SingleFlight => {
  let inflight: Promise<unknown> | null = null
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      if (inflight) return inflight as Promise<T>
      const promise = fn().finally(() => {
        if (inflight === promise) inflight = null
      })
      inflight = promise
      return promise
    },
    isRunning: () => inflight !== null
  }
}

// ---------- 版本探测（1 字节） ----------

// 用 `Range: bytes=0-0` 探一次远端版本，只读响应头、正文立即丢弃。
// 返回 null 表示两个源都不可用（离线 / 被限流 / 超时）→ 调用方应沿用本地缓存
export const probeRemoteVersion = async (options: ProbeOptions = {}): Promise<RemoteVersion | null> => {
  const fetchImpl =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init))
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS

  for (const url of options.sources ?? MODEL_SOURCES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
        redirect: 'follow'
      })
      if (!response.ok) {
        discardBody(response)
        continue
      }
      const range = parseContentRange(response.headers.get('content-range'))
      const contentLength = Number(response.headers.get('content-length')) || 0
      // ⚠️ 总长只信两处：206 的 Content-Range（安全列表外，浏览器里可能读不到）或
      // 200（源站忽略 Range）的 Content-Length。206 的 Content-Length 是本次响应体长
      // （Range: 0-0 → 1 字节），读不到 Content-Range 时它绝不能当总长——曾导致
      // 183MB ≠ 1 误判 'stale' → 清缓存重下整包（见 test-cases TC-06-9）
      const total = range && range.total > 0 ? range.total : response.status === 200 ? contentLength : 0
      const etag = response.headers.get('etag')
      // Last-Modified 在 CORS 安全列表内恒可见 → ETag 被隐藏时的替代比对信号
      const lastModified = response.headers.get('last-modified')
      discardBody(response)
      if (total > 0 || etag || lastModified) return { etag, lastModified, total, source: new URL(url).host }
    } catch {
      // 离线 / 超时 / CORS → 换下一个源
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

// ---------- 下载 ----------

// 探测节流状态（上次成功探测时间戳）：跨标签共享，存 chrome.storage.local
export interface ProbeStateStore {
  getLastProbeAt: () => Promise<number>
  setLastProbeAt: (timestamp: number) => Promise<void>
}

export interface DownloadModelOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  cache?: ModelCache | null
  partial?: PartialStore | null
  lock?: DownloadLock | null
  probe?: (options: ProbeOptions) => Promise<RemoteVersion | null>
  sleep?: (ms: number) => Promise<void>
  onProgress?: ModelProgress
  // 另一窗口正在下载、本窗口处于等待（UI 显示「另一窗口下载中」）
  onWaiting?: (waiting: boolean) => void
  // 确认走网络下载（缓存未命中或已过期作废）：UI 据此才显示下载提示；
  // 缓存命中全程静默（仅控制台日志），不打扰用户
  onDownloadStart?: () => void
  // 探测节流状态存取（缺省 chrome.storage.local；node/测试注入内存实现或 null）
  probeState?: ProbeStateStore | null
  // 是否在线（缺省读 navigator.onLine；离线跳过探测直接沿用缓存）
  isOnline?: () => boolean
  // 探测节流窗口（缺省 PROBE_THROTTLE_MS；单测注入极小值）
  probeThrottleMs?: number
  stallTimeoutMs?: number
  maxAttempts?: number
  lockPollMs?: number
  lockWaitRounds?: number
}

export const downloadModel = async (options: DownloadModelOptions = {}): Promise<ArrayBuffer> => {
  const fetchImpl =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init))
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const onProgress = options.onProgress
  const onWaiting = options.onWaiting
  const onDownloadStart = options.onDownloadStart
  const probeState = options.probeState !== undefined ? options.probeState : createChromeProbeState()
  const isOnline =
    options.isOnline ??
    (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const probeThrottleMs = options.probeThrottleMs ?? PROBE_THROTTLE_MS
  const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const lockPollMs = options.lockPollMs ?? LOCK_POLL_MS
  const lockWaitRounds = options.lockWaitRounds ?? LOCK_WAIT_ROUNDS
  const cache = options.cache !== undefined ? options.cache : createBrowserModelCache()
  const partial = options.partial !== undefined ? options.partial : createBrowserPartialStore()
  const lock = options.lock !== undefined ? options.lock : createModelLock(createChromeStorageCompat())
  const probe = options.probe ?? probeRemoteVersion

  // 0) 旧版缓存 key 一次性迁移（升级用户不重下 183MB）
  if (await cache?.migrateLegacy?.()) {
    console.log('[ContextWatchdog] 旧版缓存已迁移，无需重新下载')
  }

  // 1) 完整缓存命中 → 1 字节探测确认版本（探测失败 = 离线等 → 直接用缓存，离线优先）。
  //    离线或 24h 内已探测过（节流，跨标签共享计时）→ 跳过探测直接沿用缓存；
  //    探测成功（无论结论）刷新节流时间戳，失败不刷新（下次打开还会再试）
  const cached = await cache?.match()
  if (cached) {
    let remote: RemoteVersion | null = null
    const lastProbeAt = (await probeState?.getLastProbeAt()) ?? 0
    if (shouldProbeRemote({ online: isOnline(), lastProbeAt, now: Date.now(), throttleMs: probeThrottleMs })) {
      remote = await probe({ fetchImpl })
      if (remote) await probeState?.setLastProbeAt(Date.now())
    } else {
      console.log(
        `[ContextWatchdog] 跳过版本探测（${isOnline() ? `距上次探测不足 ${Math.round(probeThrottleMs / 3600000)} 小时` : '离线'}），直接沿用缓存`
      )
    }
    const verdict = compareCachedVersion(cached, remote)
    if (verdict !== 'stale') {
      console.log(
        `[ContextWatchdog] 模型命中本地缓存（${(cached.buffer.byteLength / 1048576).toFixed(1)} MB，版本${
          verdict === 'current' ? '一致' : '未知→离线优先'
        }），跳过下载`
      )
      onProgress?.(100, cached.buffer.byteLength, cached.buffer.byteLength)
      return cached.buffer
    }
    console.warn('[ContextWatchdog] 远端模型已更新，本地缓存作废并重新下载')
    await cache?.clear()
  }

  // 走到此处 = 缓存未命中或已作废，接下来必然是网络下载（本窗口或等待另一窗口）→
  // 通知 UI 显式提示；缓存命中路径在上面已静默返回，不触发本回调
  onDownloadStart?.()

  // 2) 多窗口去重：抢不到锁就等另一窗口完成；等不到（对方失败/锁过期/超时）则接管
  const waitForOtherWindow = async (): Promise<ArrayBuffer | null> => {
    onWaiting?.(true)
    try {
      for (let round = 0; round < lockWaitRounds; round++) {
        const state = await lock?.read()
        if (!state || state.expiresAt <= Date.now()) {
          await lock?.tryAcquire()
          return null
        }
        if (state.percent >= 100) {
          // 对方刚下完，缓存可能还在落盘 → 再轮询几轮
          const done = await cache?.match()
          if (done) {
            onProgress?.(100, done.buffer.byteLength, done.buffer.byteLength)
            return done.buffer
          }
        } else if (state.total > 0 || state.received > 0) {
          // 转发对方进度，等待方 UI 不空转
          onProgress?.(progressPercent(state.received, state.total), state.received, state.total)
        }
        await sleep(lockPollMs)
      }
      return null // 等太久 → 自己下（即便对方仍在跑，正确性不受影响，只多耗带宽）
    } finally {
      onWaiting?.(false)
    }
  }

  if (!(lock ? await lock.tryAcquire() : true)) {
    const shared = await waitForOtherWindow()
    if (shared) return shared
    // 接管路径：对方可能刚好写完缓存 → 再查一次，避免重复下载
    const finished = await cache?.match()
    if (finished) {
      onProgress?.(100, finished.buffer.byteLength, finished.buffer.byteLength)
      return finished.buffer
    }
  }

  // 3) 跨会话断点：上次中断留下的部分文件
  const chunks: Uint8Array[] = []
  let received = 0 // 已收总字节 = 下次续传的 Range 起点
  let total = 0 // 期望总字节；0 = 未知
  let resumeEtag: string | null = null
  let resumeSource: string | null = null
  let resumeLastModified: string | null = null

  const storedPartial = await partial?.load()
  if (storedPartial) {
    chunks.push(new Uint8Array(storedPartial.buffer))
    received = storedPartial.buffer.byteLength
    total = storedPartial.meta.total
    resumeEtag = storedPartial.meta.etag
    resumeSource = storedPartial.meta.source
    resumeLastModified = storedPartial.meta.lastModified ?? null
    console.log(
      `[ContextWatchdog] 命中未完成的下载（${(received / 1048576).toFixed(1)} MB${
        total > 0 ? ` / ${(total / 1048576).toFixed(0)} MB` : ''
      }），从断点续传`
    )
    onProgress?.(progressPercent(received, total), received, total)
  }

  // 进度上报 + 心跳写锁（节流）
  let lastHeartbeat = 0
  const reportProgress: ModelProgress = (percent, receivedNow, totalNow) => {
    onProgress?.(percent, receivedNow, totalNow)
    const stamp = Date.now()
    if (stamp - lastHeartbeat < HEARTBEAT_THROTTLE_MS) return
    lastHeartbeat = stamp
    void lock
      ?.heartbeat({
        percent: percent > 0 ? percent : 0,
        received: receivedNow ?? 0,
        total: totalNow ?? 0
      })
      .catch(() => undefined)
  }

  // 断点落盘：只存"没下全"的部分（下全的路径直接存完整模型）
  const savePartial = async (): Promise<void> => {
    if (!partial || received <= 0) return
    if (total > 0 && received >= total) return
    await partial.save(mergeChunks(chunks), {
      total,
      etag: resumeEtag,
      source: resumeSource,
      lastModified: resumeLastModified,
      savedAt: Date.now()
    })
  }

  const failures: string[] = []
  let retryAfterSeconds: number | null = null

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const delay = backoffDelayMs(attempt - 1, retryAfterSeconds)
        retryAfterSeconds = null
        await sleep(delay)
      }

      const url = MODEL_SOURCES[(attempt - 1) % MODEL_SOURCES.length]
      const headers: Record<string, string> = {}
      if (received > 0) {
        headers.Range = `bytes=${received}-`
        // If-Range 只在"回到同一源且拿到强 etag"时才发：
        // 不同源的 etag 形态不同，跨源带了必然被判为不匹配 → 白白重下
        if (!isWeakEtag(resumeEtag) && resumeSource && new URL(url).host === resumeSource) {
          headers['If-Range'] = resumeEtag as string
        }
      }
      const controller = new AbortController()
      let stallTimer: ReturnType<typeof setTimeout> | null = null
      const armStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = setTimeout(() => controller.abort(), stallTimeoutMs)
      }

      try {
        armStallTimer()
        const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'follow' })

        if (!response.ok) {
          failures.push(`${new URL(url).host}: HTTP ${response.status}`)
          retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'))
          if (!RETRYABLE_STATUS.has(response.status)) retryAfterSeconds = null
          console.warn(`[ContextWatchdog] 模型源返回 ${response.status}:`, url)
          discardBody(response)
          continue
        }

        const responseEtag = response.headers.get('etag')
        if (responseEtag) {
          resumeEtag = responseEtag
          resumeSource = new URL(url).host
        }
        // Last-Modified 是 CORS 安全列表头：浏览器里 ETag 恒为 null 时全靠它当版本身份
        const responseLastModified = response.headers.get('last-modified')
        if (responseLastModified) resumeLastModified = responseLastModified

        // 本次响应没有给出新 etag 时，重置分支必须把旧的 (etag, 源) 归属一并作废，
        // 否则残留的旧 etag 会随部分文件/缓存条目流传，让版本探测比对错对象；
        // Last-Modified 同理：本次响应没带就不留，防比对错对象
        const dropStaleEtag = (): void => {
          if (!responseEtag) {
            resumeEtag = null
            resumeSource = null
          }
          if (!responseLastModified) resumeLastModified = null
        }

        // 断点续传语义核对：源站必须真的从我们给的偏移开始
        if (received > 0 && response.status === 200) {
          // 源站忽略 Range（或 If-Range 判定文件已变）→ 从头下载
          console.warn('[ContextWatchdog] 源站返回 200（忽略 Range 或文件已更新），重置续传基准从头下载')
          chunks.length = 0
          received = 0
          dropStaleEtag()
        } else if (received > 0 && response.status === 206) {
          const contentRange = parseContentRange(response.headers.get('content-range'))
          if (!contentRange || contentRange.start !== received) {
            console.warn('[ContextWatchdog] 续传偏移与响应不一致，重置续传基准', contentRange, received)
            chunks.length = 0
            received = 0
            dropStaleEtag()
            discardBody(response)
            continue
          }
          // 跨源续传时用总长兜底：上游换了文件 → 总长变 → 重置，防拼接脏数据
          if (total > 0 && contentRange.total > 0 && contentRange.total !== total) {
            console.warn('[ContextWatchdog] 上游文件总长变化，重置续传基准', contentRange.total, total)
            chunks.length = 0
            received = 0
            total = contentRange.total
            dropStaleEtag()
            discardBody(response)
            continue
          }
        }

        const contentLength = Number(response.headers.get('content-length')) || 0
        const rangeInfo =
          response.status === 206 ? parseContentRange(response.headers.get('content-range')) : null
        if (rangeInfo && rangeInfo.total > 0) total = rangeInfo.total
        else if (response.status === 200 && contentLength > 0) total = contentLength

        const reader = response.body?.getReader()
        if (!reader) throw new Error('响应没有正文流')

        while (true) {
          armStallTimer()
          const { done, value } = await reader.read()
          // 看门狗触发（或连接被中断）：保留已收字节，落盘后交给下次续传
          if (controller.signal.aborted) {
            throw new Error(`下载停滞超过 ${Math.round(stallTimeoutMs / 1000)} 秒`)
          }
          if (done) break
          if (!value) continue
          chunks.push(value)
          received += value.length
          reportProgress(progressPercent(received, total), received, total)
        }
        if (stallTimer) {
          clearTimeout(stallTimer)
          stallTimer = null
        }

        // 传输完整性校验：没下全不入缓存、不返回，走续传
        if (total > 0 && received < total) {
          failures.push(`${new URL(url).host}: 连接中断（${received}/${total} 字节）`)
          await savePartial()
          continue
        }
        if (total > 0 && received > total) {
          console.warn('[ContextWatchdog] 收到超出预期的字节数，重置续传基准', received, total)
          chunks.length = 0
          received = 0
          total = 0
          resumeEtag = null
          resumeSource = null
          resumeLastModified = null
          await partial?.clear()
          continue
        }

        const buffer = mergeChunks(chunks, total > 0 ? total : undefined)
        await cache?.put(buffer, {
          etag: resumeEtag,
          source: resumeSource,
          lastModified: resumeLastModified
        })
        await partial?.clear()
        // 完成心跳：等待方看到 100% 才会去读缓存，避免它每轮都拉 183MB
        await lock?.heartbeat({ percent: 100, received: buffer.byteLength, total: buffer.byteLength })
        onProgress?.(100, buffer.byteLength, buffer.byteLength)
        return buffer
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${new URL(url).host}: ${message}`)
        console.warn(`[ContextWatchdog] 模型下载第 ${attempt}/${maxAttempts} 次失败:`, message)
        await savePartial()
      } finally {
        if (stallTimer) clearTimeout(stallTimer)
      }
    }
  } finally {
    await lock?.release()
  }

  throw new Error(`模型下载失败（已尝试 ${maxAttempts} 次）：${failures.join('；')}`)
}

// chrome.storage.local 适配（无 chrome 时返回 null → 锁退化为不加锁）
const createChromeStorageCompat = (): {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
} | null => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
  return {
    get: key =>
      new Promise(resolve => {
        chrome.storage.local.get(key, result => resolve(result as Record<string, unknown>))
      }),
    set: items => new Promise(resolve => chrome.storage.local.set(items, () => resolve()))
  }
}

// 探测节流状态的默认实现：时间戳存 chrome.storage.local（两个标签页/侧栏共享计时）；
// 无 chrome（node/测试环境）返回 null → 每次打开都探测（保持旧行为）
const createChromeProbeState = (): ProbeStateStore | null => {
  const compat = createChromeStorageCompat()
  if (!compat) return null
  return {
    getLastProbeAt: async () => {
      const result = await compat.get(PROBE_STAMP_KEY)
      const value = result[PROBE_STAMP_KEY]
      return typeof value === 'number' && value > 0 ? value : 0
    },
    setLastProbeAt: async timestamp => {
      await compat.set({ [PROBE_STAMP_KEY]: timestamp })
    }
  }
}
