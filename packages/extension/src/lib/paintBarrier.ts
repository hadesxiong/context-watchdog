// 「等一帧真的画出来」屏障。
//
// 为什么单独成模块：这个时序过去修错过一次——长文本检测是同步长任务（实测 516KB
// 约 1.6s），若遮罩的 DOM 更新与检测在同一任务里，遮罩根本没机会上屏（表现为
// 「遮罩没出现」或「卡死不转」）。而 nextTick 与 rAF **都不能**保证已绘制：
//   · nextTick 只冲刷 Vue 的 DOM 更新，不触发布局与绘制；
//   · rAF 回调发生在**绘制之前**（"update the rendering" 里先跑回调、后跑
//     style/layout/paint），所以在 rAF 里直接开跑长任务，那一帧的绘制同样被跳过。
// 可靠的屏障是 rAF 之后再插一个宏任务：渲染步骤恰好发生在这两个任务之间，
// setTimeout(0) 的回调执行时，那一帧已经画过。
//
// 抽出来是为了让这条**顺序属性**能在 node 下单测（不必真跑浏览器）：
// 见 tests/unit/paintBarrier.test.ts。rAF-then-macrotask 的顺序一旦被改回去，
// 用例立刻变红。
//
// 面板不可见时 rAF 与定时器都可能被节流，故同时挂一个超时兜底，避免把调用方
// 永久挂住（宁可早一点上屏，也不能卡死检测）。

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
