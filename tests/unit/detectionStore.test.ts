// 单元用例 - detection store 的模型加载状态机
// 覆盖：加载成功 / 假成功防护 / 60 秒停滞超时 / 进度重置超时与字节映射 /
//       setAiEnabled 复位 / 另一窗口下载中的等待标记
// 需要 fake timers：initNER 的 60 秒停滞超时是真实 setTimeout
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { ModelProgress } from '../../src/core/detector/modelDownload'
import { preloadModels, isContentModelReady } from '../../src/core/detector'
import { useDetectionStore } from '../../src/stores/detection'

vi.mock('../../src/core/detector', () => ({
  detect: vi.fn(),
  preloadModels: vi.fn(),
  isContentModelReady: vi.fn()
}))

const mockedPreload = vi.mocked(preloadModels)
const mockedReady = vi.mocked(isContentModelReady)

// 默认：立即加载完成且模型真实就绪
const stubLoadSuccess = () => {
  mockedPreload.mockResolvedValue(undefined)
  mockedReady.mockReturnValue(true)
}

describe('detection store - 模型加载状态机', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    setActivePinia(createPinia())
    stubLoadSuccess()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('setAiEnabled(true)：加载完成且模型真实就绪 → success', async () => {
    const store = useDetectionStore()
    await store.setAiEnabled(true)

    expect(store.aiEnabled).toBe(true)
    expect(store.nerStatus).toBe('success')
    expect(store.nerLoadProgress).toBe(100)
    expect(store.nerError).toBeNull()
    expect(store.engineStatus.contentModel).toBe(true)
    expect(store.engineStatus.sceneModel).toBe(true)
  })

  it('防假成功：preloadModels resolve 但模型未就绪 → error', async () => {
    mockedReady.mockReturnValue(false)
    const store = useDetectionStore()
    await store.setAiEnabled(true)

    expect(store.nerStatus).toBe('error')
    expect(store.nerError).toContain('未就绪')
    expect(store.engineStatus.contentModel).toBe(false)
    expect(store.engineStatus.sceneModel).toBe(false)
  })

  it('60 秒无任何进度推进 → timeout，不永久卡 loading', async () => {
    // 永不完成的下载（模拟停滞）
    mockedPreload.mockImplementation(() => new Promise(() => undefined))
    const store = useDetectionStore()

    const pending = store.setAiEnabled(true)
    expect(store.nerStatus).toBe('loading')

    await vi.advanceTimersByTimeAsync(60_000)
    await pending

    expect(store.nerStatus).toBe('timeout')
    expect(store.nerError).toContain('60 秒无进展')
    expect(store.engineStatus.contentModel).toBe(false)
  })

  it('进度持续推进会重置超时；字节与不定进度映射到 UI', async () => {
    let progress: ModelProgress | undefined
    mockedPreload.mockImplementation(async onProgress => {
      progress = onProgress
      // 未知总长先报一次不定进度，之后每 30 秒推进一次（始终小于 60 秒停滞阈值）
      onProgress?.(-1, 91_717_687, 0)
      await new Promise<void>(resolve => setTimeout(resolve, 30_000))
      onProgress?.(25, 400, 1600)
      await new Promise<void>(resolve => setTimeout(resolve, 30_000))
      onProgress?.(50, 800, 1600)
      await new Promise<void>(resolve => setTimeout(resolve, 30_000))
      onProgress?.(100, 1600, 1600)
    })
    const store = useDetectionStore()

    const pending = store.setAiEnabled(true)
    await vi.advanceTimersByTimeAsync(0) // 让首帧进度落地

    // 未知总长 → 不定进度（干转圈而不是假百分比）
    expect(store.nerIndeterminate).toBe(true)
    expect(store.nerLoadBytes).toBe(91_717_687)
    expect(progress).toBeTypeOf('function')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(store.nerStatus).toBe('loading') // 30 秒处不会被 60 秒超时误杀
    expect(store.nerIndeterminate).toBe(false)
    expect(store.nerLoadProgress).toBe(25)
    expect(store.nerLoadBytes).toBe(400)
    expect(store.nerLoadTotal).toBe(1600)

    await vi.advanceTimersByTimeAsync(30_000) // t=60s：上一次进度把停滞计时又推后了
    expect(store.nerStatus).toBe('loading')
    expect(store.nerLoadProgress).toBe(50)

    await vi.advanceTimersByTimeAsync(30_000) // t=90s：加载完成
    await pending
    expect(store.nerStatus).toBe('success')
    expect(store.engineStatus.contentModel).toBe(true)
  })

  it('setAiEnabled(false)：卸载状态并回退纯正则', async () => {
    const store = useDetectionStore()
    await store.setAiEnabled(true)
    expect(store.nerStatus).toBe('success')

    await store.setAiEnabled(false)

    expect(store.aiEnabled).toBe(false)
    expect(store.nerStatus).toBe('disabled')
    expect(store.nerLoadProgress).toBe(0)
    expect(store.nerIndeterminate).toBe(false)
    expect(store.nerError).toBeNull()
    expect(store.nerWaitingOtherWindow).toBe(false)
    expect(store.engineStatus.contentModel).toBe(false)
    expect(store.engineStatus.sceneModel).toBe(false)
  })

  it('等待另一窗口下载时置位标记，结束后复位并转发对方进度', async () => {
    const store = useDetectionStore()
    let seenDuringLoad = false
    let midFlightProgress = -1

    mockedPreload.mockImplementation(async (onProgress, onWaiting) => {
      onWaiting?.(true) // 锁被另一窗口持有 → 进入等待
      seenDuringLoad = store.nerWaitingOtherWindow
      onProgress?.(50, 50, 100) // 转发对方的进度，等待方 UI 不空转
      midFlightProgress = store.nerLoadProgress
      onWaiting?.(false)
    })

    await store.setAiEnabled(true)

    expect(seenDuringLoad).toBe(true) // 加载过程中 UI 能看到「另一窗口下载中」
    expect(midFlightProgress).toBe(50) // 等待方真实显示了对方的进度
    expect(store.nerWaitingOtherWindow).toBe(false) // 结束后必然复位
    expect(store.nerLoadProgress).toBe(100) // 成功后封顶 100
    expect(store.nerStatus).toBe('success')
  })
})

describe('detection store - AI 增强首启引导', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    setActivePinia(createPinia())
    stubLoadSuccess()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认（无 storage 环境）：从未展示过且未启用 → 应弹引导', () => {
    const store = useDetectionStore()

    expect(store.aiOnboardingSeen).toBe(false)
    expect(store.shouldShowOnboarding).toBe(true)
  })

  it('markOnboardingSeen 置位后永不再弹', () => {
    const store = useDetectionStore()
    expect(store.shouldShowOnboarding).toBe(true)

    store.markOnboardingSeen()

    expect(store.aiOnboardingSeen).toBe(true)
    expect(store.shouldShowOnboarding).toBe(false)
  })

  it('已启用过 AI 的老用户：即使从未见过引导也不弹', async () => {
    const store = useDetectionStore()
    await store.setAiEnabled(true)

    expect(store.shouldShowOnboarding).toBe(false)
  })
})
