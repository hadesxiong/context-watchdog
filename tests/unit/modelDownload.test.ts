// 单元用例 - 模型下载器
// 覆盖：多源回退 / 会话内+跨会话断点续传 / 指数退避与 Retry-After / 传输完整性校验 /
//       Cache Storage 落盘 / 缓存版本探测（1 字节）与离线降级 / 多窗口锁与等待方 /
//       停滞看门狗 / 单飞门闩（重试复用在飞加载）
import { describe, it, expect } from 'vitest'
import {
  MODEL_SOURCES,
  MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  PROBE_THROTTLE_MS,
  parseContentRange,
  parseRetryAfter,
  backoffDelayMs,
  progressPercent,
  mergeChunks,
  isWeakEtag,
  compareCachedVersion,
  shouldProbeRemote,
  probeRemoteVersion,
  createModelLock,
  createSingleFlight,
  downloadModel,
  type ModelCache,
  type PartialStore,
  type PartialModelMeta,
  type ProbeStateStore,
  type RemoteVersion
} from '@/model/modelDownload'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const toBytes = (text: string) => encoder.encode(text)

interface FakeCall {
  url: string
  headers: Record<string, string>
}

type FetchHandler = (call: FakeCall, index: number, signal: AbortSignal | null) => Response

// 可控 fake fetch：记录每次调用的 URL 与请求头（小写）
const createFakeFetch = (handler: FetchHandler) => {
  const calls: FakeCall[] = []
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {}
    const raw = (init?.headers ?? {}) as Record<string, string>
    for (const [key, value] of Object.entries(raw)) headers[key.toLowerCase()] = String(value)
    const call: FakeCall = { url: input, headers }
    calls.push(call)
    return handler(call, calls.length - 1, (init?.signal as AbortSignal) ?? null)
  }
  return { fetchImpl, calls }
}

// 造 Response：自定义状态码/响应头 + 一次性正文流（Node 的 Response 不允许随意覆盖 content-length）
const makeResponse = (status: number, headers: Record<string, string>, parts: Uint8Array[]): Response => {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    }
  })
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    body: {
      getReader: () => stream.getReader(),
      cancel: async () => undefined
    },
    arrayBuffer: async () => mergeChunks(parts)
  } as unknown as Response
}

// 造「吐完 parts 后一直挂起、直到 signal abort 才报错」的 Response（模拟连接停滞）
const makeHangingResponse = (
  headers: Record<string, string>,
  parts: Uint8Array[],
  signal: AbortSignal | null
): Response => {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  let index = 0
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (index < parts.length) return { done: false, value: parts[index++] }
          if (!signal) return new Promise(() => undefined) // 永久挂起
          return new Promise((_, reject) => {
            if (signal.aborted) {
              reject(new Error('aborted'))
              return
            }
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        },
        cancel: async () => undefined
      })
    },
    arrayBuffer: async () => mergeChunks(parts)
  } as unknown as Response
}

// 内存版完整缓存（替代 Cache Storage 的完整模型条目）
const createMemoryCache = (initial?: ArrayBuffer, etag?: string | null, source?: string | null) => {
  let stored: {
    buffer: ArrayBuffer
    etag: string | null
    lastModified?: string | null
    total: number
    savedAt: number
    source: string | null
  } | null = initial
    ? { buffer: initial, etag: etag ?? null, total: initial.byteLength, savedAt: Date.now(), source: source ?? null }
    : null
  const cache: ModelCache = {
    match: async () => stored,
    put: async (buffer, meta) => {
      stored = {
        buffer,
        etag: meta?.etag ?? null,
        lastModified: meta?.lastModified ?? null,
        total: buffer.byteLength,
        savedAt: Date.now(),
        source: meta?.source ?? null
      }
    },
    clear: async () => {
      stored = null
    }
  }
  return { cache, read: () => stored }
}

// 内存版部分文件（替代 Cache Storage 的 partial 条目）
const createMemoryPartial = (initial?: { buffer: ArrayBuffer; meta: PartialModelMeta }) => {
  let stored: { buffer: ArrayBuffer; meta: PartialModelMeta } | null = initial ?? null
  const store: PartialStore = {
    load: async () => stored,
    save: async (buffer, meta) => {
      stored = { buffer, meta }
    },
    clear: async () => {
      stored = null
    }
  }
  return { store, read: () => stored }
}

// 内存版 KV（替代 chrome.storage.local，供多窗口锁使用）
const createMemoryStorage = () => {
  const map = new Map<string, unknown>()
  return {
    map,
    storage: {
      get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) map.set(key, value)
      }
    }
  }
}

// 内存版探测节流状态（替代 chrome.storage.local 的时间戳存取）
const createMemoryProbeState = (initial = 0): ProbeStateStore & { reads: number; writes: number[] } => {
  let last = initial
  const state = {
    reads: 0,
    writes: [] as number[],
    getLastProbeAt: async () => {
      state.reads++
      return last
    },
    setLastProbeAt: async (timestamp: number) => {
      state.writes.push(timestamp)
      last = timestamp
    }
  }
  return state
}

const noSleep = async (): Promise<void> => undefined

describe('纯函数', () => {
  it('parseContentRange 解析正常 / 未知总长 / 非法输入', () => {
    expect(parseContentRange('bytes 40-99/100')).toEqual({ start: 40, total: 100 })
    expect(parseContentRange('bytes 0-9/1234567890')).toEqual({ start: 0, total: 1234567890 })
    expect(parseContentRange('bytes 0-9/*')).toEqual({ start: 0, total: 0 })
    expect(parseContentRange('items 0-9/10')).toBeNull()
    expect(parseContentRange(null)).toBeNull()
    expect(parseContentRange('')).toBeNull()
  })

  it('parseRetryAfter 支持秒数与 HTTP-date', () => {
    expect(parseRetryAfter('120')).toBe(120)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter('nonsense')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
    const future = new Date(Date.now() + 5000).toUTCString()
    const seconds = parseRetryAfter(future)
    expect(seconds).not.toBeNull()
    expect(seconds!).toBeGreaterThanOrEqual(3)
    expect(seconds!).toBeLessThanOrEqual(6)
  })

  it('backoffDelayMs 指数退避 + 封顶 + Retry-After 优先', () => {
    expect(backoffDelayMs(1)).toBe(RETRY_BASE_DELAY_MS)
    expect(backoffDelayMs(2)).toBe(RETRY_BASE_DELAY_MS * 2)
    expect(backoffDelayMs(3)).toBe(RETRY_BASE_DELAY_MS * 4)
    expect(backoffDelayMs(9)).toBe(RETRY_MAX_DELAY_MS) // 封顶
    expect(backoffDelayMs(1, 3)).toBe(3000)
    expect(backoffDelayMs(1, 0)).toBe(RETRY_BASE_DELAY_MS) // 不小于基础延迟
    expect(backoffDelayMs(1, 9999)).toBe(RETRY_MAX_DELAY_MS) // 封顶
  })

  it('progressPercent 已知总长给百分比（封顶 99），未知给 -1', () => {
    expect(progressPercent(50, 100)).toBe(50)
    expect(progressPercent(0, 100)).toBe(0)
    expect(progressPercent(100, 100)).toBe(99)
    expect(progressPercent(10, 0)).toBe(-1)
    expect(progressPercent(10, -5)).toBe(-1)
  })

  it('mergeChunks 按序拼接，长度不符抛错', () => {
    const merged = mergeChunks([toBytes('abc'), toBytes('defg')], 7)
    expect(decoder.decode(merged)).toBe('abcdefg')
    expect(mergeChunks([toBytes('ab')]).byteLength).toBe(2) // 未给 total 时按分片求和
    expect(() => mergeChunks([toBytes('ab')], 5)).toThrow(/不完整/)
  })

  it('isWeakEtag：弱校验值不能用于 If-Range', () => {
    expect(isWeakEtag(null)).toBe(true)
    expect(isWeakEtag('')).toBe(true)
    expect(isWeakEtag('W/"abc"')).toBe(true)
    expect(isWeakEtag('"abc"')).toBe(false)
  })

  it('compareCachedVersion：etag 优先、长度兜底、探测失败用缓存', () => {
    const remote = (etag: string | null, total: number): RemoteVersion => ({ etag, total, source: 'x' })
    expect(compareCachedVersion({ etag: 'A', total: 10 }, remote('A', 999))).toBe('current')
    expect(compareCachedVersion({ etag: 'A', total: 10 }, remote('B', 10))).toBe('stale')
    expect(compareCachedVersion({ etag: null, total: 10 }, remote('B', 10))).toBe('current')
    expect(compareCachedVersion({ etag: null, total: 10 }, remote(null, 11))).toBe('stale')
    expect(compareCachedVersion({ etag: 'A', total: 10 }, null)).toBe('unknown')
    expect(compareCachedVersion({ etag: null, total: 0 }, remote(null, 0))).toBe('unknown')
  })

  it('compareCachedVersion：CORS 隐藏 ETag 时用 Last-Modified 三级比对（修复二次打开误判重下）', () => {
    // ModelScope 浏览器实况：CDN 不发 Access-Control-Expose-Headers → 两侧 etag 均读不到（null），
    // 只有安全列表头 Last-Modified 可见可比
    const cached = {
      etag: null,
      lastModified: 'Wed, 11 Dec 2024 14:46:20 GMT',
      total: 183403734,
      source: 'modelscope.cn'
    }
    // 探测侧 total=0（206 读不到 Content-Range）也必须能判 current，不依赖总长
    expect(
      compareCachedVersion(cached, {
        etag: null,
        lastModified: 'Wed, 11 Dec 2024 14:46:20 GMT',
        total: 0,
        source: 'modelscope.cn'
      })
    ).toBe('current')
    // 远端换了文件 → Last-Modified 变 → stale（即便总长未知，也不放行）
    expect(
      compareCachedVersion(cached, {
        etag: null,
        lastModified: 'Fri, 09 Jan 2026 03:14:15 GMT',
        total: 0,
        source: 'modelscope.cn'
      })
    ).toBe('stale')
    // 跨源：Last-Modified 各源生成，不可比 → 退回总长；总长又不可知 → unknown（沿用缓存）
    expect(
      compareCachedVersion(cached, {
        etag: null,
        lastModified: 'Wed, 11 Dec 2024 14:46:20 GMT',
        total: 0,
        source: 'huggingface.co'
      })
    ).toBe('unknown')
    // 一侧没有 Last-Modified（旧条目 / 非浏览器环境）→ 退回总长，行为与从前一致
    expect(
      compareCachedVersion(
        { etag: null, total: 10, source: 'x' },
        { etag: null, lastModified: 'any', total: 10, source: 'x' }
      )
    ).toBe('current')
  })

  it('compareCachedVersion：跨源时 ETag 不可比，退回比总长（防误判清缓存）', () => {
    // HF 下载（etag hf-*）+ ModelScope 探测（etag ms-*）：同文件不同源 ETag 必然不同 → 不能判 stale
    const cached = { etag: '"hf-abc"', total: 183403734, source: 'huggingface.co' }
    const remoteMs: RemoteVersion = { etag: '"ms-xyz"', total: 183403734, source: 'modelscope.cn' }
    expect(compareCachedVersion(cached, remoteMs)).toBe('current')

    // 跨源且总长也变了 → 真过期
    const changed: RemoteVersion = { etag: '"ms-new"', total: 999, source: 'modelscope.cn' }
    expect(compareCachedVersion(cached, changed)).toBe('stale')

    // 跨源但任一侧总长未知 → unknown（沿用缓存）
    const unknownTotal: RemoteVersion = { etag: '"ms-x"', total: 0, source: 'modelscope.cn' }
    expect(compareCachedVersion({ etag: '"hf"', total: 0, source: 'huggingface.co' }, unknownTotal)).toBe('unknown')

    // 同源仍然比 ETag（总长相同但 ETag 变 → stale）
    const sameSource: RemoteVersion = { etag: '"ms-new"', total: 183403734, source: 'modelscope.cn' }
    expect(compareCachedVersion({ etag: '"ms-old"', total: 183403734, source: 'modelscope.cn' }, sameSource)).toBe('stale')

    // 旧缓存条目无 source（升级前写入）：按同源处理，保持旧比对行为
    expect(compareCachedVersion({ etag: '"a"', total: 10 }, { etag: '"b"', total: 10, source: 'x' })).toBe('stale')
  })

  it('shouldProbeRemote：离线跳过、24h 节流、过期再探', () => {
    const now = 1_000_000_000_000
    // 离线 → 永不探测（即便从未探过）
    expect(shouldProbeRemote({ online: false, lastProbeAt: 0, now })).toBe(false)
    // 从未探测过 → 探
    expect(shouldProbeRemote({ online: true, lastProbeAt: 0, now })).toBe(true)
    // 刚探过（不足节流窗口）→ 跳过
    expect(
      shouldProbeRemote({ online: true, lastProbeAt: now - PROBE_THROTTLE_MS + 60_000, now })
    ).toBe(false)
    // 节流窗口已过 → 再探
    expect(
      shouldProbeRemote({ online: true, lastProbeAt: now - PROBE_THROTTLE_MS - 1, now })
    ).toBe(true)
    // 自定义节流窗口（单测用极小值）
    expect(shouldProbeRemote({ online: true, lastProbeAt: now - 5, now, throttleMs: 10 })).toBe(false)
    expect(shouldProbeRemote({ online: true, lastProbeAt: now - 11, now, throttleMs: 10 })).toBe(true)
  })
})

describe('版本探测（1 字节）', () => {
  it('206 响应取 total 与 etag，正文立即丢弃', async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      makeResponse(
        206,
        {
          'content-range': 'bytes 0-0/183403734',
          etag: '"abc"',
          'last-modified': 'Wed, 11 Dec 2024 14:46:20 GMT'
        },
        [new Uint8Array(1)]
      )
    )
    const version = await probeRemoteVersion({ fetchImpl })
    expect(version).toEqual({
      etag: '"abc"',
      lastModified: 'Wed, 11 Dec 2024 14:46:20 GMT',
      total: 183403734,
      source: new URL(MODEL_SOURCES[0]).host
    })
    expect(calls[0].headers.range).toBe('bytes=0-0')
  })

  it('浏览器视角（CORS 未暴露）：206 读不到 Content-Range/ETag 时 content-length(1) 不当总长', async () => {
    // ModelScope CDN 实测无 Access-Control-Expose-Headers → JS 只剩安全列表头：
    // content-length=1（Range:0-0 的响应体长）可见、Content-Range 与 ETag 不可见、Last-Modified 可见。
    // 曾把 183MB ≠ 1 误判为 stale → 清缓存重下整包（实机现象：第二次打开必重下、第三次起正常）
    const { fetchImpl } = createFakeFetch(() =>
      makeResponse(206, { 'content-length': '1', 'last-modified': 'Wed, 11 Dec 2024 14:46:20 GMT' }, [
        new Uint8Array(1)
      ])
    )
    const version = await probeRemoteVersion({ fetchImpl })
    expect(version).toEqual({
      etag: null,
      lastModified: 'Wed, 11 Dec 2024 14:46:20 GMT',
      total: 0, // 绝不能是 1
      source: new URL(MODEL_SOURCES[0]).host
    })
  })

  it('浏览器视角：206 没有任何可用元数据 → 返回 null（调用方沿用缓存，不误判 stale）', async () => {
    const { fetchImpl } = createFakeFetch(() =>
      makeResponse(206, { 'content-length': '1' }, [new Uint8Array(1)])
    )
    expect(await probeRemoteVersion({ fetchImpl })).toBeNull()
  })

  it('首源失败时换次源；全失败返回 null（调用方据此沿用缓存）', async () => {
    const { fetchImpl, calls } = createFakeFetch((call, index) => {
      if (index === 0) throw new Error('offline')
      return makeResponse(206, { 'content-range': 'bytes 0-0/100', etag: '"hf"' }, [new Uint8Array(1)])
    })
    const version = await probeRemoteVersion({ fetchImpl })
    expect(version?.source).toBe(new URL(MODEL_SOURCES[1]).host)
    expect(calls).toHaveLength(2)

    const dead = createFakeFetch(() => {
      throw new Error('offline')
    })
    expect(await probeRemoteVersion({ fetchImpl: dead.fetchImpl })).toBeNull()
  })
})

describe('多窗口下载锁', () => {
  it('未过期时他人抢不到；过期后可接管；release 后可再抢', async () => {
    const { storage } = createMemoryStorage()
    let clock = 1_000
    const now = () => clock
    const a = createModelLock(storage, { now, ttlMs: 30_000 })
    const b = createModelLock(storage, { now, ttlMs: 30_000 })

    expect(await a.tryAcquire()).toBe(true)
    expect(await b.tryAcquire()).toBe(false)

    clock += 30_001 // 心跳 TTL 过期
    expect(await b.tryAcquire()).toBe(true)

    await b.release()
    expect(await createModelLock(storage, { now }).tryAcquire()).toBe(true)
  })

  it('心跳写入进度；非持有者心跳失败', async () => {
    const { storage } = createMemoryStorage()
    const a = createModelLock(storage)
    const b = createModelLock(storage)
    await a.tryAcquire()

    expect(await a.heartbeat({ percent: 42, received: 42, total: 100 })).toBe(true)
    expect(await b.heartbeat({ percent: 1, received: 1, total: 100 })).toBe(false)
    expect(await b.read()).toMatchObject({ percent: 42, received: 42, total: 100 })
  })

  it('无 storage（node/无 chrome）时锁退化为始终可抢', async () => {
    const lock = createModelLock(null)
    expect(await lock.tryAcquire()).toBe(true)
    expect(await lock.read()).toBeNull()
  })
})

describe('单飞门闩（修复「卡住后点重试假成功/永久卡 loading」）', () => {
  it('并发调用复用同一个 promise，任务只启动一次', async () => {
    const gate = createSingleFlight()
    let started = 0
    const slow = () => new Promise<string>(resolve => setTimeout(() => resolve('done'), 10))

    const p1 = gate.run(() => { started++; return slow() })
    const p2 = gate.run(() => { started++; return slow() })

    expect(gate.isRunning()).toBe(true)
    expect(started).toBe(1)
    expect(await p1).toBe('done')
    expect(await p2).toBe('done')
    expect(gate.isRunning()).toBe(false)
  })

  it('失败会释放门闩，后续调用可重新启动', async () => {
    const gate = createSingleFlight()
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(gate.isRunning()).toBe(false)
    expect(await gate.run(() => Promise.resolve('again'))).toBe('again')
  })
})

describe('downloadModel', () => {
  const sample = (() => {
    const bytes = new Uint8Array(100)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    return bytes
  })()

  it('正常下载：进度单调推进、结果写入缓存、只请求一次', async () => {
    const { fetchImpl, calls } = createFakeFetch(() =>
      makeResponse(
        200,
        {
          'content-length': String(sample.length),
          etag: '"v1"',
          'last-modified': 'Wed, 11 Dec 2024 14:46:20 GMT'
        },
        [sample]
      )
    )
    const progress: number[] = []
    const { cache, read } = createMemoryCache()

    const buffer = await downloadModel({
      fetchImpl,
      cache,
      partial: null,
      lock: null,
      sleep: noSleep,
      onProgress: percent => progress.push(percent)
    })

    expect(calls.length).toBe(1)
    expect(calls[0].headers.range).toBeUndefined()
    expect(new Uint8Array(buffer)).toEqual(sample)
    expect(progress[progress.length - 1]).toBe(100)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress) // 单调不减
    expect(read()?.etag).toBe('"v1"') // ETag 已随条目保存，供版本探测比对
    expect(read()?.source).toBe(new URL(MODEL_SOURCES[0]).host) // 来源已保存，跨源比对退回比总长
    expect(read()?.lastModified).toBe('Wed, 11 Dec 2024 14:46:20 GMT') // Last-Modified 随条目保存（浏览器读不到 ETag 时的比对依据）
  })

  it('缓存命中 + 探测一致：零网络请求', async () => {
    const { cache } = createMemoryCache(toBytes('cached-model').buffer as ArrayBuffer, '"v1"')
    let fetched = 0
    const progress: number[] = []

    const buffer = await downloadModel({
      fetchImpl: async () => {
        fetched++
        throw new Error('不应发起网络请求')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => ({ etag: '"v1"', total: 12, source: 'modelscope.cn' }),
      sleep: noSleep,
      onProgress: percent => progress.push(percent)
    })

    expect(fetched).toBe(0)
    expect(decoder.decode(buffer)).toBe('cached-model')
    expect(progress).toEqual([100])
  })

  it('缓存命中但探测失败（离线）：沿用缓存（离线优先）', async () => {
    const { cache, read } = createMemoryCache(toBytes('cached-model').buffer as ArrayBuffer)
    let fetched = 0

    const buffer = await downloadModel({
      fetchImpl: async () => {
        fetched++
        throw new Error('offline')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => null,
      sleep: noSleep
    })

    expect(fetched).toBe(0)
    expect(decoder.decode(buffer)).toBe('cached-model')
    expect(read()).not.toBeNull()
  })

  it('缓存命中但远端已更新：清缓存并重新下载', async () => {
    const fresh = encoder.encode('fresh-model')
    const { cache, read } = createMemoryCache(toBytes('old-model').buffer as ArrayBuffer, '"old"')
    const { fetchImpl } = createFakeFetch(() =>
      makeResponse(200, { 'content-length': String(fresh.length), etag: '"new"' }, [fresh])
    )

    const buffer = await downloadModel({
      fetchImpl,
      cache,
      partial: null,
      lock: null,
      probe: async () => ({ etag: '"new"', total: fresh.length, source: 'modelscope.cn' }),
      sleep: noSleep
    })

    expect(decoder.decode(buffer)).toBe('fresh-model')
    expect(read()?.etag).toBe('"new"')
  })

  it('传输截断：不入缓存，下次带 Range 从断点续传', async () => {
    const head = sample.slice(0, 40)
    const tail = sample.slice(40)
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        // 声称 100 字节却只吐 40 → 判定为截断
        ? makeResponse(200, { 'content-length': '100' }, [head])
        : makeResponse(206, { 'content-length': '60', 'content-range': 'bytes 40-99/100' }, [tail])
    )
    const delays: number[] = []

    const buffer = await downloadModel({ fetchImpl, cache: null, partial: null, lock: null, sleep: async ms => { delays.push(ms) } })

    expect(calls.length).toBe(2)
    expect(calls[1].headers.range).toBe('bytes=40-')
    expect(delays).toEqual([RETRY_BASE_DELAY_MS])
    expect(new Uint8Array(buffer)).toEqual(sample)
  })

  it('跨会话续传：读上次的部分文件，同源带 Range + If-Range，完成后清除', async () => {
    const head = sample.slice(0, 40)
    const tail = sample.slice(40)
    const { store, read } = createMemoryPartial({
      buffer: head.buffer as ArrayBuffer,
      meta: { total: 100, etag: '"v1"', source: new URL(MODEL_SOURCES[0]).host, savedAt: Date.now() }
    })
    const { fetchImpl, calls } = createFakeFetch(() =>
      makeResponse(206, { 'content-length': '60', 'content-range': 'bytes 40-99/100', etag: '"v1"' }, [tail])
    )

    const buffer = await downloadModel({ fetchImpl, cache: null, partial: store, lock: null, sleep: noSleep })

    expect(calls[0].headers.range).toBe('bytes=40-')
    expect(calls[0].headers['if-range']).toBe('"v1"') // 同源 + 强 etag → 带 If-Range
    expect(new Uint8Array(buffer)).toEqual(sample)
    expect(read()).toBeNull() // 完成后部分文件被清除
  })

  it('跨源续传：不发 If-Range，总长不符时重置基准重下', async () => {
    const head = sample.slice(0, 40)
    const { store } = createMemoryPartial({
      buffer: head.buffer as ArrayBuffer,
      meta: { total: 100, etag: '"old"', source: 'huggingface.co', savedAt: Date.now() }
    })
    // 第 1 次落到 ModelScope：206 声称总长 999 ≠ 已存 100 → 判定上游换了文件 → 重置
    // 第 2 次从头 200 下全
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        ? makeResponse(206, { 'content-length': '60', 'content-range': 'bytes 40-1098/999' }, [sample.slice(40)])
        : makeResponse(200, { 'content-length': '100' }, [sample])
    )

    const buffer = await downloadModel({ fetchImpl, cache: null, partial: store, lock: null, sleep: noSleep })

    expect(calls[0].headers.range).toBe('bytes=40-')
    expect(calls[0].headers['if-range']).toBeUndefined() // 跨源不带 If-Range（etg 形态不同必然判不匹配）
    expect(calls[1].headers.range).toBeUndefined() // 已重置 → 从头
    expect(new Uint8Array(buffer)).toEqual(sample)
  })

  it('源站忽略 Range（返回 200）：重置基准从头下载，结果仍然正确', async () => {
    const head = sample.slice(0, 40)
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        ? makeResponse(200, { 'content-length': '100' }, [head])
        : makeResponse(200, { 'content-length': '100' }, [sample])
    )

    const buffer = await downloadModel({ fetchImpl, cache: null, partial: null, lock: null, sleep: noSleep })

    expect(calls[1].headers.range).toBe('bytes=40-') // 确实尝试过续传
    expect(new Uint8Array(buffer)).toEqual(sample) // 重置后不产生错位拼接
  })

  it('续传响应偏移不匹配：重置基准而不是拼错数据', async () => {
    const head = sample.slice(0, 40)
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        ? makeResponse(200, { 'content-length': '100' }, [head])
        // 服务器无视我们的偏移，从 0 开始返回 206
        : makeResponse(206, { 'content-length': '100', 'content-range': 'bytes 0-99/100' }, [sample])
    )

    const buffer = await downloadModel({ fetchImpl, cache: null, partial: null, lock: null, sleep: noSleep })

    expect(calls[1].headers.range).toBe('bytes=40-')
    expect(new Uint8Array(buffer)).toEqual(sample)
  })

  it('全部尝试失败时保留部分文件（供下次跨会话续传）', async () => {
    const head = sample.slice(0, 40)
    const { fetchImpl } = createFakeFetch(() =>
      makeResponse(200, { 'content-length': '100', etag: '"v1"' }, [head])
    )
    const { store, read } = createMemoryPartial()

    await expect(
      downloadModel({ fetchImpl, cache: null, partial: store, lock: null, sleep: noSleep })
    ).rejects.toThrow(/模型下载失败/)

    const saved = read()
    expect(saved?.buffer.byteLength).toBe(40)
    expect(saved?.meta.total).toBe(100)
    expect(saved?.meta.etag).toBe('"v1"')
    expect(saved?.meta.source).toBe(new URL(MODEL_SOURCES[0]).host)
  })

  it('429 + Retry-After：按 Retry-After 退避后重试成功', async () => {
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        ? makeResponse(429, { 'retry-after': '3' }, [])
        : makeResponse(200, { 'content-length': '5' }, [toBytes('hello')])
    )
    const delays: number[] = []

    const buffer = await downloadModel({ fetchImpl, cache: null, partial: null, lock: null, sleep: async ms => { delays.push(ms) } })

    expect(delays).toEqual([3000])
    expect(calls.length).toBe(2)
    expect(decoder.decode(buffer)).toBe('hello')
  })

  it('停滞看门狗：卡住的连接被中断，下一轮从断点续传', async () => {
    const head = sample.slice(0, 40)
    const tail = sample.slice(40)
    const { fetchImpl, calls } = createFakeFetch((_call, index, signal) =>
      index === 0
        // 吐 40 字节后一直挂起 → 看门狗 abort
        ? makeHangingResponse({ 'content-length': '100' }, [head], signal)
        : makeResponse(206, { 'content-length': '60', 'content-range': 'bytes 40-99/100' }, [tail])
    )
    const delays: number[] = []

    const buffer = await downloadModel({
      fetchImpl,
      cache: null,
      partial: null,
      lock: null,
      sleep: async ms => { delays.push(ms) },
      stallTimeoutMs: 5
    })

    expect(calls.length).toBe(2)
    expect(calls[1].headers.range).toBe('bytes=40-')
    expect(delays).toHaveLength(1)
    expect(new Uint8Array(buffer)).toEqual(sample)
  })

  it('无 Content-Length：进度报 -1（不定进度），仍能完成', async () => {
    const { fetchImpl } = createFakeFetch(() => makeResponse(200, {}, [toBytes('abc'), toBytes('def')]))
    const progress: number[] = []

    const buffer = await downloadModel({
      fetchImpl,
      cache: null,
      partial: null,
      lock: null,
      sleep: noSleep,
      onProgress: percent => progress.push(percent)
    })

    expect(progress).toContain(-1)
    expect(progress[progress.length - 1]).toBe(100)
    expect(decoder.decode(buffer)).toBe('abcdef')
  })

  it('所有源都失败：轮换源站重试到上限，错误带各源详情', async () => {
    const { fetchImpl, calls } = createFakeFetch(() => makeResponse(404, {}, []))

    let message = ''
    try {
      await downloadModel({ fetchImpl, cache: null, partial: null, lock: null, sleep: noSleep })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/模型下载失败/)
    expect(message).toContain('modelscope.cn')
    expect(message).toContain('huggingface.co')
    expect(message).toContain('HTTP 404')
    expect(calls.length).toBe(MAX_ATTEMPTS)
    expect(calls[0].url).toBe(MODEL_SOURCES[0])
    expect(calls[1].url).toBe(MODEL_SOURCES[1])
    expect(calls[2].url).toBe(MODEL_SOURCES[0])
  })

  it('多窗口：抢不到锁则等待，对方写完缓存后直接命中，全程零网络', async () => {
    const { storage } = createMemoryStorage()
    const otherWindow = createModelLock(storage)
    await otherWindow.tryAcquire()
    await otherWindow.heartbeat({ percent: 50, received: 50, total: 100 })

    const { cache } = createMemoryCache()
    const forwarded: number[] = []
    const waitingEvents: boolean[] = []
    let fetchCount = 0
    let polls = 0

    const buffer = await downloadModel({
      fetchImpl: async () => {
        fetchCount++
        throw new Error('不应发起网络请求')
      },
      cache,
      lock: createModelLock(storage),
      partial: null,
      probe: async () => null,
      lockPollMs: 1,
      sleep: async () => {
        polls++
        if (polls === 2) {
          // 模拟对方窗口下载完成：写缓存 + 完成心跳
          await cache.put(sample.buffer as ArrayBuffer)
          await otherWindow.heartbeat({ percent: 100, received: 100, total: 100 })
        }
      },
      onProgress: (percent, received, total) => { if (percent >= 0) forwarded.push(percent) },
      onWaiting: value => waitingEvents.push(value)
    })

    expect(fetchCount).toBe(0)
    expect(new Uint8Array(buffer)).toEqual(sample)
    expect(forwarded).toContain(50) // 等待方转发了对方的进度
    expect(waitingEvents).toEqual([true, false])
  })

  it('多窗口：对方锁已过期 → 直接接管继续下载', async () => {
    const { storage, map } = createMemoryStorage()
    // 对方 30 秒没心跳（关面板/崩溃），锁已过期
    map.set('pasteguard.modelLock', {
      owner: 'other-dead',
      expiresAt: Date.now() - 1,
      percent: 30,
      received: 30,
      total: 100
    })
    const { fetchImpl } = createFakeFetch(() =>
      makeResponse(200, { 'content-length': String(sample.length) }, [sample])
    )
    const waitingEvents: boolean[] = []

    const buffer = await downloadModel({
      fetchImpl,
      cache: null,
      partial: null,
      lock: createModelLock(storage),
      probe: async () => null,
      sleep: noSleep,
      onWaiting: value => waitingEvents.push(value)
    })

    expect(new Uint8Array(buffer)).toEqual(sample)
    expect(waitingEvents).toEqual([]) // 无需等待
  })

  it('跨源缓存命中：ETag 不同但总长一致 → 不清缓存不重下（修复误判 stale）', async () => {
    // 首次下载走 HF（缓存记 source=huggingface.co），探测命中 ModelScope 且 ETag 不同
    const { cache } = createMemoryCache(
      toBytes('cached-model').buffer as ArrayBuffer,
      '"hf-abc"',
      'huggingface.co'
    )
    let fetched = 0

    const buffer = await downloadModel({
      fetchImpl: async () => {
        fetched++
        throw new Error('不应发起网络请求')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => ({ etag: '"ms-xyz"', total: 12, source: 'modelscope.cn' }),
      sleep: noSleep
    })

    expect(fetched).toBe(0)
    expect(decoder.decode(buffer)).toBe('cached-model')
  })

  it('缓存命中不触发 onDownloadStart（静默）；真网络下载触发一次', async () => {
    // 缓存命中 → 不触发（命中全程静默，仅控制台日志）
    const { cache } = createMemoryCache(toBytes('cached-model').buffer as ArrayBuffer)
    let downloadStarts = 0
    await downloadModel({
      fetchImpl: async () => {
        throw new Error('不应发起网络请求')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => null,
      sleep: noSleep,
      onDownloadStart: () => { downloadStarts++ }
    })
    expect(downloadStarts).toBe(0)

    // 真下载 → 触发一次
    const { fetchImpl } = createFakeFetch(() =>
      makeResponse(200, { 'content-length': '5' }, [toBytes('hello')])
    )
    await downloadModel({
      fetchImpl,
      cache: null,
      partial: null,
      lock: null,
      sleep: noSleep,
      onDownloadStart: () => { downloadStarts++ }
    })
    expect(downloadStarts).toBe(1)
  })

  it('缓存过期作废 → 触发 onDownloadStart（会重下，须显式提示）', async () => {
    const { cache } = createMemoryCache(toBytes('old-model').buffer as ArrayBuffer, '"old"')
    const { fetchImpl } = createFakeFetch(() =>
      makeResponse(200, { etag: '"new"', 'content-length': '9' }, [toBytes('new-model')])
    )
    let downloadStarts = 0
    await downloadModel({
      fetchImpl,
      cache,
      partial: null,
      lock: null,
      probe: async () => ({ etag: '"new"', total: 9, source: 'modelscope.cn' }),
      sleep: noSleep,
      onDownloadStart: () => { downloadStarts++ }
    })
    expect(downloadStarts).toBe(1)
  })

  it('离线（isOnline=false）：跳过探测直接沿用缓存，探测零次', async () => {
    const { cache } = createMemoryCache(toBytes('cached-model').buffer as ArrayBuffer, '"v1"')
    let probes = 0
    let fetched = 0

    const buffer = await downloadModel({
      fetchImpl: async () => {
        fetched++
        throw new Error('不应发起网络请求')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => {
        probes++
        return null
      },
      isOnline: () => false,
      sleep: noSleep
    })

    expect(probes).toBe(0)
    expect(fetched).toBe(0)
    expect(decoder.decode(buffer)).toBe('cached-model')
  })

  it('探测节流：24h 内再开新标签 → 跳过探测直接用缓存', async () => {
    const probeState = createMemoryProbeState(Date.now() - 60_000) // 1 分钟前刚探测过
    const { cache } = createMemoryCache(toBytes('cached-model').buffer as ArrayBuffer, '"v1"')
    let probes = 0

    const buffer = await downloadModel({
      fetchImpl: async () => {
        throw new Error('不应发起网络请求')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => {
        probes++
        return null
      },
      probeState,
      sleep: noSleep
    })

    expect(probes).toBe(0)
    expect(probeState.writes).toEqual([]) // 跳过探测不刷新时间戳
    expect(decoder.decode(buffer)).toBe('cached-model')
  })

  it('探测节流：窗口过期 → 重新探测并刷新时间戳；探测失败不刷新', async () => {
    // 节流过期 → 探测成功 → 时间戳刷新
    const probeState = createMemoryProbeState(Date.now() - PROBE_THROTTLE_MS - 1)
    const { cache } = createMemoryCache(toBytes('cached-model').buffer as ArrayBuffer, '"v1"')
    let probes = 0
    const startedAt = Date.now()

    const buffer = await downloadModel({
      fetchImpl: async () => {
        throw new Error('不应发起网络请求')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => {
        probes++
        return { etag: '"v1"', total: 12, source: 'modelscope.cn' }
      },
      probeState,
      sleep: noSleep
    })

    expect(probes).toBe(1)
    expect(probeState.writes).toHaveLength(1)
    expect(probeState.writes[0]).toBeGreaterThanOrEqual(startedAt) // 刷新为当前时间
    expect(decoder.decode(buffer)).toBe('cached-model')

    // 探测失败（全源不可达）→ 不刷新时间戳（下次打开还会再试）
    const probeState2 = createMemoryProbeState(Date.now() - PROBE_THROTTLE_MS - 1)
    await downloadModel({
      fetchImpl: async () => {
        throw new Error('不应发起网络请求')
      },
      cache,
      partial: null,
      lock: null,
      probe: async () => null,
      probeState: probeState2,
      sleep: noSleep
    })
    expect(probeState2.writes).toEqual([])
  })
})
