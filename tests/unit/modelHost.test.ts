import { describe, expect, it } from 'vitest'
import {
  initialModelHostState,
  withDownloadStarted,
  withError,
  withProgress,
  withReady,
  withWaiting
} from '@/modelHost/state'
import { isModelHostReply, isModelHostRequest } from '@/modelHost/protocol'

// 模型宿主的两块纯逻辑：状态迁移与端口消息守卫。
//
// 为什么值得单独测：状态在 offscreen 里写、在侧栏里读，中间隔着 storage.session，
// 浏览器里只能靠肉眼判断"进度卡住/重试后错误没清掉/就绪了还显示等待中"。
// 这些分支在 node 里是纯函数，钉死它们比事后看截图便宜得多。

describe('模型宿主状态迁移', () => {
  it('初始为 idle，percent=-1 表示未知总长', () => {
    const state = initialModelHostState(1)
    expect(state).toMatchObject({ phase: 'idle', percent: -1, received: 0, total: 0, waiting: false, error: null })
  })

  it('进度：进入 loading，缺省的 received/total 沿用上一次', () => {
    const first = withProgress(initialModelHostState(), 42, 1024, 4096, 10)
    expect(first).toMatchObject({ phase: 'loading', percent: 42, received: 1024, total: 4096 })

    const second = withProgress(first, 50, undefined, undefined, 20)
    expect(second).toMatchObject({ percent: 50, received: 1024, total: 4096 })
  })

  it('进度会清掉上一次的错误（重试已开始）', () => {
    const failed = withError(initialModelHostState(), 'network', 10)
    expect(withProgress(failed, 1, 0, 0, 20).error).toBeNull()
  })

  it('等待另一窗口下载时 phase 仍是 loading，且不把 ready 打回 loading', () => {
    expect(withWaiting(initialModelHostState(), true, 10)).toMatchObject({
      phase: 'loading',
      waiting: true
    })
    const ready = withReady(initialModelHostState(), 10)
    expect(withWaiting(ready, true, 20)).toMatchObject({ phase: 'ready', waiting: true })
  })

  it('确认走网络下载才置 downloadStarted（缓存命中保持 false）', () => {
    expect(withDownloadStarted(initialModelHostState(), 10).downloadStarted).toBe(true)
    expect(withReady(initialModelHostState(), 10).downloadStarted).toBe(false)
  })

  it('就绪：percent=100，清掉 waiting 与 error', () => {
    const waiting = withError(withWaiting(initialModelHostState(), true, 10), 'x', 20)
    expect(withReady(waiting, 30)).toMatchObject({ phase: 'ready', percent: 100, waiting: false, error: null })
  })

  it('失败：进入 error 并记录消息，waiting 归零', () => {
    expect(withError(withWaiting(initialModelHostState(), true, 10), 'boom', 20)).toMatchObject({
      phase: 'error',
      error: 'boom',
      waiting: false
    })
  })
})

describe('端口消息守卫', () => {
  it('接受三种 op（token 必须是非空字符串）', () => {
    expect(isModelHostRequest({ op: 'PING', token: 'a' })).toBe(true)
    expect(isModelHostRequest({ op: 'ENSURE', token: 'a' })).toBe(true)
    expect(isModelHostRequest({ op: 'DETECT', token: 'a', text: 'x' })).toBe(true)
  })

  it('拒绝未知 op / 缺 token / 空 token / 非对象', () => {
    expect(isModelHostRequest({ op: 'UNLOAD', token: 'a' })).toBe(false)
    expect(isModelHostRequest({ op: 'PING' })).toBe(false)
    expect(isModelHostRequest({ op: 'PING', token: '' })).toBe(false)
    expect(isModelHostRequest(null)).toBe(false)
    expect(isModelHostRequest('PING')).toBe(false)
  })

  it('回包守卫要求 token 与布尔 ok', () => {
    expect(isModelHostReply({ token: 'a', ok: true })).toBe(true)
    expect(isModelHostReply({ token: 'a', ok: false, error: 'x' })).toBe(true)
    expect(isModelHostReply({ token: 'a' })).toBe(false)
    expect(isModelHostReply({ ok: true })).toBe(false)
    expect(isModelHostReply(undefined)).toBe(false)
  })
})
