// 单元用例 - 模型下载器
// 覆盖：多源回退 / Range 断点续传 / 指数退避与 Retry-After / 传输完整性校验 /
//       Cache Storage 落盘 / 停滞看门狗 / 单飞门闩（重试复用在飞加载）
import { describe, it, expect } from 'vitest'
import {
  MODEL_SOURCES,
  MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  parseContentRange,
  parseRetryAfter,
  backoffDelayMs,
  progressPercent,
  mergeChunks,
  createSingleFlight,
  downloadModel,
  type ModelCache
} from '../../src/core/detector/modelDownload'

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

// 内存版缓存（替代 Cache Storage）
const createMemoryCache = (initial?: ArrayBuffer) => {
  let stored: ArrayBuffer | null = initial ?? null
  const cache: ModelCache = {
    match: async () => stored,
    put: async buffer => {
      stored = buffer
    }
  }
  return { cache, read: () => stored }
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
      makeResponse(200, { 'content-length': String(sample.length) }, [sample])
    )
    const progress: number[] = []
    const { cache, read } = createMemoryCache()

    const buffer = await downloadModel({
      fetchImpl,
      cache,
      sleep: noSleep,
      onProgress: percent => progress.push(percent)
    })

    expect(calls.length).toBe(1)
    expect(calls[0].headers.range).toBeUndefined()
    expect(new Uint8Array(buffer)).toEqual(sample)
    expect(progress[progress.length - 1]).toBe(100)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress) // 单调不减
    expect(read()).not.toBeNull() // 已落盘
  })

  it('缓存命中：零网络请求', async () => {
    const { cache } = createMemoryCache(toBytes('cached-model').buffer as ArrayBuffer)
    let fetched = 0
    const progress: number[] = []

    const buffer = await downloadModel({
      fetchImpl: async () => {
        fetched++
        throw new Error('不应发起网络请求')
      },
      cache,
      sleep: noSleep,
      onProgress: percent => progress.push(percent)
    })

    expect(fetched).toBe(0)
    expect(decoder.decode(buffer)).toBe('cached-model')
    expect(progress).toEqual([100])
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
    const { cache, read } = createMemoryCache()

    const buffer = await downloadModel({
      fetchImpl,
      cache,
      sleep: async ms => { delays.push(ms) }
    })

    expect(calls.length).toBe(2)
    expect(calls[1].headers.range).toBe('bytes=40-')
    expect(delays).toEqual([RETRY_BASE_DELAY_MS])
    expect(new Uint8Array(buffer)).toEqual(sample)
    expect(read()).not.toBeNull()
  })

  it('源站忽略 Range（返回 200）：重置基准从头下载，结果仍然正确', async () => {
    const head = sample.slice(0, 40)
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        ? makeResponse(200, { 'content-length': '100' }, [head])
        : makeResponse(200, { 'content-length': '100' }, [sample])
    )

    const buffer = await downloadModel({ fetchImpl, cache: null, sleep: noSleep })

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

    const buffer = await downloadModel({ fetchImpl, cache: null, sleep: noSleep })

    expect(calls[1].headers.range).toBe('bytes=40-')
    expect(new Uint8Array(buffer)).toEqual(sample)
  })

  it('429 + Retry-After：按 Retry-After 退避后重试成功', async () => {
    const { fetchImpl, calls } = createFakeFetch((_call, index) =>
      index === 0
        ? makeResponse(429, { 'retry-after': '3' }, [])
        : makeResponse(200, { 'content-length': '5' }, [toBytes('hello')])
    )
    const delays: number[] = []

    const buffer = await downloadModel({
      fetchImpl,
      cache: null,
      sleep: async ms => { delays.push(ms) }
    })

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
      await downloadModel({ fetchImpl, cache: null, sleep: noSleep })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/模型下载失败/)
    expect(message).toContain('modelscope.cn')
    expect(message).toContain('huggingface.co')
    expect(message).toContain('HTTP 404')
    expect(calls.length).toBe(MAX_ATTEMPTS)
    // 按 MODEL_SOURCES 轮换
    expect(calls[0].url).toBe(MODEL_SOURCES[0])
    expect(calls[1].url).toBe(MODEL_SOURCES[1])
    expect(calls[2].url).toBe(MODEL_SOURCES[0])
  })
})
