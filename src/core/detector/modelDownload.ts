// GLiNER 模型下载器
// 职责：多源回退 → Range 断点续传 → 指数退避重试（尊重 Retry-After）→ 停滞看门狗 →
//       传输完整性校验 → Cache Storage 落盘（重开侧栏零下载）
// 独立成模块的原因：fetch / cache / sleep 全部可注入，便于在 node 环境下单测
// （见 tests/unit/modelDownload.test.ts）

// 进度回调：percent < 0 表示未知总长（UI 走不定进度动画）；received/total 供 UI 展示 MB
export type ModelProgress = (percent: number, received?: number, total?: number) => void

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

// 当前模型文件字节数，用作缓存版本号：上游模型更新时改这里即可让旧缓存自动失效
export const MODEL_FILE_BYTES = 183403734

export const MODEL_CACHE_NAME = 'pasteguard-models'
// 合成 URL（.invalid 永不解析）：仅作为 Cache Storage 的 key，不参与网络请求
export const MODEL_CACHE_URL =
  `https://pasteguard.invalid/models/gliner_small-v2/model_quantized.onnx?v=${MODEL_FILE_BYTES}`

export const MAX_ATTEMPTS = 5
// 单次尝试的停滞看门狗：这么久没收到任何字节就中断本次连接，下次从断点续传
export const STALL_TIMEOUT_MS = 30_000
export const RETRY_BASE_DELAY_MS = 1_000
export const RETRY_MAX_DELAY_MS = 16_000
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

// 丢弃不需要的响应正文（释放连接）；body 缺失/已锁定时静默忽略
const discardBody = (response: Response): void => {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    // 忽略
  }
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

// ---------- Cache Storage ----------

export interface ModelCache {
  match: () => Promise<ArrayBuffer | null>
  put: (buffer: ArrayBuffer) => Promise<void>
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
        // 0 字节（上次写入被中断）视为无效，丢弃重下
        return buffer.byteLength > 0 ? buffer : null
      } catch (error) {
        console.warn('[PasteGuard] 读取模型缓存失败（改为网络下载）:', error)
        return null
      }
    },
    put: async buffer => {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME)
        await cache.put(
          MODEL_CACHE_URL,
          new Response(buffer, {
            headers: {
              'Content-Length': String(buffer.byteLength),
              'Content-Type': 'application/octet-stream'
            }
          })
        )
        console.log(`[PasteGuard] 模型已写入缓存（${(buffer.byteLength / 1048576).toFixed(1)} MB），下次启动零下载`)
      } catch (error) {
        // 缓存失败不影响本次使用（下次再下一遍而已）
        console.warn('[PasteGuard] 写入模型缓存失败（不影响本次加载）:', error)
      }
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

// ---------- 下载 ----------

export interface DownloadModelOptions {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  cache?: ModelCache | null
  sleep?: (ms: number) => Promise<void>
  onProgress?: ModelProgress
  stallTimeoutMs?: number
  maxAttempts?: number
}

export const downloadModel = async (options: DownloadModelOptions = {}): Promise<ArrayBuffer> => {
  const fetchImpl =
    options.fetchImpl ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init))
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const onProgress = options.onProgress
  const stallTimeoutMs = options.stallTimeoutMs ?? STALL_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS
  const cache = options.cache !== undefined ? options.cache : createBrowserModelCache()

  // 1) 本地缓存命中 → 零网络
  const cached = await cache?.match()
  if (cached) {
    console.log(`[PasteGuard] 模型命中本地缓存（${(cached.byteLength / 1048576).toFixed(1)} MB），跳过下载`)
    onProgress?.(100, cached.byteLength, cached.byteLength)
    return cached
  }

  const chunks: Uint8Array[] = []
  let received = 0 // 已收总字节 = 下次续传的 Range 起点
  let total = 0 // 期望总字节；0 = 未知
  const failures: string[] = []
  let retryAfterSeconds: number | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const delay = backoffDelayMs(attempt - 1, retryAfterSeconds)
      retryAfterSeconds = null
      await sleep(delay)
    }

    const url = MODEL_SOURCES[(attempt - 1) % MODEL_SOURCES.length]
    const headers: Record<string, string> = received > 0 ? { Range: `bytes=${received}-` } : {}
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
        console.warn(`[PasteGuard] 模型源返回 ${response.status}:`, url)
        discardBody(response)
        continue
      }

      // 断点续传语义核对：源站必须真的从我们给的偏移开始
      if (received > 0 && response.status === 200) {
        console.warn('[PasteGuard] 源站忽略 Range 请求，重置续传基准从头下载')
        chunks.length = 0
        received = 0
      } else if (received > 0 && response.status === 206) {
        const contentRange = parseContentRange(response.headers.get('content-range'))
        if (!contentRange || contentRange.start !== received) {
          console.warn('[PasteGuard] 续传偏移与响应不一致，重置续传基准', contentRange, received)
          chunks.length = 0
          received = 0
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
        // 看门狗触发（或连接被中断）：保留已收字节，交给下一轮 Range 续传
        if (controller.signal.aborted) {
          throw new Error(`下载停滞超过 ${Math.round(stallTimeoutMs / 1000)} 秒`)
        }
        if (done) break
        if (!value) continue
        chunks.push(value)
        received += value.length
        onProgress?.(progressPercent(received, total), received, total)
      }
      if (stallTimer) {
        clearTimeout(stallTimer)
        stallTimer = null
      }

      // 传输完整性校验：没下全不入缓存、不返回，走续传
      if (total > 0 && received < total) {
        failures.push(`${new URL(url).host}: 连接中断（${received}/${total} 字节）`)
        continue
      }
      if (total > 0 && received > total) {
        console.warn('[PasteGuard] 收到超出预期的字节数，重置续传基准', received, total)
        chunks.length = 0
        received = 0
        total = 0
        continue
      }

      const buffer = mergeChunks(chunks, total > 0 ? total : undefined)
      await cache?.put(buffer)
      onProgress?.(100, buffer.byteLength, buffer.byteLength)
      return buffer
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${new URL(url).host}: ${message}`)
      console.warn(`[PasteGuard] 模型下载第 ${attempt}/${maxAttempts} 次失败:`, message)
    } finally {
      if (stallTimer) clearTimeout(stallTimer)
    }
  }

  throw new Error(`模型下载失败（已尝试 ${maxAttempts} 次）：${failures.join('；')}`)
}
