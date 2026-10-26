// 「等一帧画出来」屏障的顺序护栏：守的是一个**顺序**，不是一个数值 —— 屏障必须在 rAF 之后
// **再让出一个宏任务**。原因见 lib/paintBarrier.ts：rAF 回调发生在绘制前，屏障若在 rAF 回调里
// 就兑现，长文本检测的同步长任务（实测 516KB ≈ 1.6s）会把该帧绘制整段跳过，表现为「遮罩没出现」。
// 退化写法 requestAnimationFrame(finish) + setTimeout(finish, 100) 会在下面第二条用例里红。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { waitForPaint } from '@/lib/paintBarrier'

type FrameCallback = () => void

let frames: FrameCallback[]
let rafCalls: number

/** 最小 DOM/rAF 桩：node 环境没有这些全局量 */
const installEnv = (visibilityState: 'visible' | 'hidden' = 'visible'): void => {
  frames = []
  rafCalls = 0
  vi.stubGlobal('document', { visibilityState })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameCallback) => {
    rafCalls += 1
    frames.push(cb)
    return rafCalls
  })
}

const runFrames = (): void => {
  const queued = frames
  frames = []
  queued.forEach((cb) => cb())
}

let resolved: boolean

beforeEach(() => {
  vi.useFakeTimers()
  installEnv()
  resolved = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('waitForPaint：必须等到「rAF 之后再让出一个宏任务」', () => {
  it('rAF 未触发前不兑现', async () => {
    void waitForPaint().then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(rafCalls).toBe(1)
  })

  it('rAF 触发后仍不兑现，要等宏任务（这正是「已绘制」的那一步）', async () => {
    void waitForPaint().then(() => { resolved = true })
    await Promise.resolve()

    runFrames()
    await Promise.resolve()
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(true)
  })

  it('rAF 一直不来时由兜底超时放行（不把调用方永久挂住）', async () => {
    void waitForPaint().then(() => { resolved = true })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(99)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })

  it('面板不可见时立即兑现（隐藏时浏览器不一定给帧）', async () => {
    installEnv('hidden')
    void waitForPaint().then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(true)
    expect(rafCalls).toBe(0)
  })
})
