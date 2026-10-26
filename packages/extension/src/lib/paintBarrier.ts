// 「等一帧真的画出来」屏障：同步长任务会把同任务里的 DOM 更新堵在上屏前，而 nextTick 只冲刷 Vue DOM、
// rAF 回调发生在绘制之前——可靠屏障 = rAF 之后再插一个宏任务（渲染恰好落在这两者之间）。单独成模块
// 以便 node 单测（tests/unit/paintBarrier.test.ts）；面板不可见时 rAF/定时器被节流，故挂超时兜底。

/** 兜底超时：rAF 与宏任务都迟迟不来时，也要放行 */
const FALLBACK_MS = 100

export const waitForPaint = (): Promise<void> => {
  // 面板隐藏时浏览器可能根本不给帧，直接放行（检测本身不需要可见）
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }

    setTimeout(finish, FALLBACK_MS)
    requestAnimationFrame(() => setTimeout(finish, 0))
  })
}
