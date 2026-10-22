// 单元用例 - 跨浏览器侧栏状态解析（panelState）
//
// 覆盖 2026-10-22 两个 Firefox 真机缺陷的修复面（CHANGELOG ⑱）：
//   ① Firefox 无 getContexts → sidebarAction.isOpen + 弹窗自追踪（状态反馈不再恒 false）
//   ② 弹窗兜底窗口可探活（不再重复点击叠窗）；文案键按宿主选择（不冒充侧栏）
// 同时锁住 ⑮ 的复数 filter 回归（单数字段会被运行时直接抛错）。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { openButtonLabelKey, readPanelState, trackPopupWindow } from '@/background/panelState'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** storage.session 的内存实现：真实按 key 存取，测试可直接看 data 断言记账/清账 */
const makeSession = (opts?: { failSet?: boolean }) => {
  const data: Record<string, unknown> = {}
  return {
    data,
    api: {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (entries: Record<string, unknown>) => {
        if (opts?.failSet) throw new Error('storage unavailable')
        Object.assign(data, entries)
      }),
      remove: vi.fn(async (key: string) => {
        delete data[key]
      })
    }
  }
}

type ChromeParts = {
  getContexts?: (filter: Record<string, unknown>) => Promise<unknown[]>
  sidebarAction?: { isOpen?: (details: Record<string, never>) => Promise<boolean> }
  windowsGet?: (id: number) => Promise<{ type: string }>
  session?: ReturnType<typeof makeSession>
}

const stubChrome = (parts: ChromeParts): ReturnType<typeof makeSession> => {
  const session = parts.session ?? makeSession()
  vi.stubGlobal('chrome', {
    runtime: {
      ...(parts.getContexts ? { getContexts: parts.getContexts } : {}),
      getURL: (path: string) => `chrome-extension://test-id/${path}`
    },
    storage: { session: session.api },
    ...(parts.windowsGet ? { windows: { get: parts.windowsGet } } : {}),
    ...(parts.sidebarAction ? { sidebarAction: parts.sidebarAction } : {})
  })
  return session
}

describe('readPanelState - Chrome 分支（有 getContexts）', () => {
  it('SIDE_PANEL context 存在 → 侧栏开着', async () => {
    stubChrome({ getContexts: async () => [{ contextType: 'SIDE_PANEL' }] })
    expect(await readPanelState()).toEqual({ open: true, kind: 'sidebar' })
  })

  it('⑮ 回归防线：弹窗用 TAB + documentUrls 复数形态查询（单数字段会被运行时抛错）', async () => {
    const calls: Record<string, unknown>[] = []
    stubChrome({
      getContexts: async filter => {
        calls.push(filter)
        // 第一段没有侧栏；第二段命中弹窗
        return filter.contextTypes?.[0] === 'TAB' ? [{ documentUrl: 'x' }] : []
      }
    })
    expect(await readPanelState()).toEqual({ open: true, kind: 'popup' })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ contextTypes: ['SIDE_PANEL'] })
    expect(calls[1]).toHaveProperty('documentUrls')
    expect(calls[1]).not.toHaveProperty('documentUrl')
  })

  it('两段都空 → 明确的没开', async () => {
    stubChrome({ getContexts: async () => [] })
    expect(await readPanelState()).toEqual({ open: false })
  })

  it('查询抛错 → 未知（undefined），不冒充结论', async () => {
    stubChrome({
      getContexts: async () => {
        throw new Error('Unexpected property')
      }
    })
    expect(await readPanelState()).toBeUndefined()
  })

  it('侧栏命中后不再查第二段', async () => {
    const getContexts = vi.fn(async () => [{ contextType: 'SIDE_PANEL' }])
    stubChrome({ getContexts })
    await readPanelState()
    expect(getContexts).toHaveBeenCalledTimes(1)
  })
})

describe('readPanelState - Firefox 分支（无 getContexts，isOpen + 弹窗自追踪）', () => {
  it('isOpen 为真 → 侧栏开着（不碰弹窗记账）', async () => {
    const session = makeSession()
    stubChrome({ sidebarAction: { isOpen: async () => true }, session })
    expect(await readPanelState()).toEqual({ open: true, kind: 'sidebar' })
    expect(session.api.get).not.toHaveBeenCalled()
  })

  it('isOpen 为假且无弹窗记账 → 明确的没开（不是未知）', async () => {
    stubChrome({ sidebarAction: { isOpen: async () => false } })
    expect(await readPanelState()).toEqual({ open: false })
  })

  it('isOpen 为假但记账的弹窗窗口还活着 → 弹窗开着', async () => {
    const session = makeSession()
    session.data['contextwatchdog.panelPopupWindowId'] = 77
    stubChrome({
      sidebarAction: { isOpen: async () => false },
      windowsGet: async () => ({ type: 'popup' }),
      session
    })
    expect(await readPanelState()).toEqual({ open: true, kind: 'popup' })
  })

  it('窗口已关（windows.get 抛错）→ 清账并报没开', async () => {
    const session = makeSession()
    session.data['contextwatchdog.panelPopupWindowId'] = 77
    stubChrome({
      sidebarAction: { isOpen: async () => false },
      windowsGet: async () => {
        throw new Error('No window with id: 77')
      },
      session
    })
    expect(await readPanelState()).toEqual({ open: false })
    expect(session.data['contextwatchdog.panelPopupWindowId']).toBeUndefined()
    expect(session.api.remove).toHaveBeenCalledWith('contextwatchdog.panelPopupWindowId')
  })

  it('id 复用防线：窗口还在但类型不是弹窗 → 清账报没开', async () => {
    const session = makeSession()
    session.data['contextwatchdog.panelPopupWindowId'] = 77
    stubChrome({
      sidebarAction: { isOpen: async () => false },
      windowsGet: async () => ({ type: 'normal' }),
      session
    })
    expect(await readPanelState()).toEqual({ open: false })
    expect(session.data['contextwatchdog.panelPopupWindowId']).toBeUndefined()
  })

  it('isOpen 自身抛错不整段作废：继续弹窗收尾，两头皆无 → 没开', async () => {
    stubChrome({
      sidebarAction: {
        isOpen: async () => {
          throw new Error('boom')
        }
      }
    })
    expect(await readPanelState()).toEqual({ open: false })
  })

  it('连 sidebarAction 都没有（极老宿主）→ 未知（undefined），语义与旧实现一致', async () => {
    stubChrome({})
    expect(await readPanelState()).toBeUndefined()
  })

  it('无侧栏 API 的宿主上弹窗兜底仍可识别（无 sidebarAction 但有活弹窗）', async () => {
    const session = makeSession()
    session.data['contextwatchdog.panelPopupWindowId'] = 77
    stubChrome({ windowsGet: async () => ({ type: 'popup' }), session })
    expect(await readPanelState()).toEqual({ open: true, kind: 'popup' })
  })
})

describe('trackPopupWindow', () => {
  it('把弹窗窗口 id 记进 storage.session', async () => {
    const session = makeSession()
    stubChrome({ session })
    await trackPopupWindow(42)
    expect(session.data['contextwatchdog.panelPopupWindowId']).toBe(42)
  })

  it('storage 写失败被吞掉，不阻断打开主流程', async () => {
    const session = makeSession({ failSet: true })
    stubChrome({ session })
    await expect(trackPopupWindow(42)).resolves.toBeUndefined()
  })
})

describe('openButtonLabelKey - 文案按宿主选择（① 文案不许撒谎）', () => {
  it('有 sidePanel（Chrome/Edge）→ 说侧栏', () => {
    expect(openButtonLabelKey(true)).toBe('site_widget_open')
  })

  it('无 sidePanel（Firefox，点击必然开弹窗）→ 说面板', () => {
    expect(openButtonLabelKey(false)).toBe('site_widget_open_panel')
  })
})
