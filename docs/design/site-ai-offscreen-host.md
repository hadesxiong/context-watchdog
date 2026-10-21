# ① 授权站点 AI 增强（页面挂件控制面 + 单一模型宿主）

> 状态：**S1–S4 已实现**（offscreen 宿主、侧栏客户端、粘贴 AI 升级、页面挂件）；S5 的文案、文档、挂件探针与宿主销毁验证已完成，剩作者真机手动验收。这是 1.0.0 之后的第一条线。
> 关联现状：`packages/extension/src/background/{service-worker,pasteEntryPoint}.ts`、
> `packages/engine/src/detector/{pipeline}.ts`、
> `packages/extension/src/model/{contentDetector,modelDownload}.ts`、
> `packages/extension/src/stores/detection.ts`、`docs/spec.md`

---

## 0. 目标与非目标

**目标**

1. 授权站点上粘贴时，除了现有的正则档，可选叠加 GLiNER AI 检测（逐站控制，默认关闭）。
2. 在授权站点页面上提供一个**常驻小挂件**作为入口：本站 AI 开关 + 打开侧边栏。
3. 用户明确知情"AI 档会有一点延迟"。

**非目标（本期不做）**

- contenteditable 富文本路径的 AI 增强（见 §3.5 结论）。
- 把模型放进页面/内容脚本（见 §1 否决理由）。
- 模型推理分片/多线程优化（`numThreads=1` 保持不变）。

---

## 1. 结论与前置约束（为什么必须改架构）

| 事实 | 出处 | 影响 |
|---|---|---|
| 模型宿主是**模块级单例**（`glinerInstance` / `ready`），只在文档上下文存在 | `contentDetector.ts:42-43,224` | 必须有"文档宿主"；SW 内恒未就绪 |
| SW 明确不加载模型，粘贴拦截自动走正则 | `service-worker.ts:5,102`、`docs/spec.md:47,187` | 现状是**已知限制**，本次要解除 |
| 推理单线程 CPU wasm、`proxy=false` | `contentDetector.ts:85,100` | 放在页面主线程会卡死宿主页面 |
| 级联只喂"正则未覆盖片段"，上限 20 段 / 8000 字 | `pipeline.ts:308-313,422` | AI 增量成本有硬上限，可直接复用做"二次升级" |
| 下载/缓存/多窗口锁已与宿主解耦，storage 为 null 也能跑 | `modelDownload.ts:261,402,575` | 新增宿主**零改动复用**下载与缓存（同一 Cache Storage 条目） |

**否决：把模型放进授权站点的常驻 document（内容脚本）**

1. 内容脚本与宿主页面**同一渲染进程、同一主线程** → 推理期间卡死用户正在用的 AI 对话页（几百 ms ~ 秒级）。
2. 每个授权标签页一份模型实例 → 内存 ×N。
3. 宿主活不过一次导航：注入函数随导航/SPA 重挂载重建，等于每次都要重建 ORT 会话。
4. WASM 编译受 CSP 管控，内容脚本很可能继承**宿主页面**的 CSP。**这一条尚未实测**，列入 §10 待验证项（我判断成立，但以实测为准）。
5. 反过来说，这些成本 offscreen 都没有：**独立进程 + 全局仅一份 + 生命周期独立于 SW**（除 `AUDIO_PLAYBACK` 外无 30s 上限）。

**保留：页面挂件本身**——它是**控制面**，成本几十 KB，不需要模型、不需要 WASM、不需要网络。

---

## 2. 目标架构

```
                         ┌──────────────────────────────┐
  授权站点页面            │  offscreen document（唯一宿主）│
  ├─ 粘贴监听（已存在）    │  - GLiNER + ORT（一份）        │
  └─ 常驻挂件（新增·控制面）│  - detect() / sanitizeText()   │
       ├ 本站 AI 开关       │  - 状态写 storage.session      │
       └ 打开侧边栏          └──────────▲───────────────────┘
                │ 消息                  │ 消息（SW 统一路由）
                ▼                       │
        ┌───────────────────────────────┴──────┐
        │      service worker（路由器 + 正则档）  │
        └───────────────▲──────────────────────┘
                        │
                侧边栏（客户端：状态订阅 + 检测请求）
```

**关键决策**

- **D1**：offscreen 是 Chrome/Edge 下**唯一的模型宿主**；侧栏不再自己加载模型（改为客户端）。
- **D2**：Firefox 无 `chrome.offscreen` → 走 `LocalHost`（侧栏内加载，即现状），接口一致。
- **D3**：所有模型流量由 **SW 统一路由**（避免"多上下文广播同一 `runtime.sendMessage`"的路由歧义）。
- **D4**：页面挂件**只做控制面**，自身不引入模型/WASM。
- **D5**：AI 是**二次升级**而不是首答——正则结果先落地，AI 结果到达后在守卫通过时替换（见 §3.5）。

---

## 3. 组件设计

### 3.1 offscreen 模型宿主（新增）

新增文件：

- `src/offscreen/index.html`（空壳页面，随手挂载入口脚本）
- `src/offscreen/host.ts`（宿主逻辑）

宿主职责：

```
onConnect('pg-model-host')
  ├─ ENSURE      → preloadModels(onProgress,onWaiting,onDownloadStart) 幂等
  │                进度经 Port 上报给 SW（宿主自己写不了 storage.session）
  ├─ DETECT      → detect(text, profile, { enableContentDetection: true }) → sanitizeText() → 回包
  ├─ PING        → 返回 ready 状态（SW 冷启动后探测宿主是否还在）
  └─ UNLOAD      → 不做（见下）
```

> **实测约束**：offscreen 文档只暴露 `chrome.runtime`（`chrome.storage` / `chrome.i18n`
> 都是 `undefined`）。因此 ① 状态必须由宿主发给 SW、SW 写 `storage.session`；
> ② 占位符语言只能用 `navigator.language`。这两点已写进 `src/offscreen/host.ts` 的注释。

生命周期：SW 在需要时 `chrome.offscreen.createDocument({ url, reasons: ['WORKERS'], justification })`（`reasons` 取最贴近的合法值，`WORKERS` 允许在宿主内起 Worker 以便后续切 `proxy=true`），并**用 `chrome.offscreen.hasDocument()` 幂等化**；`creating` 变量必须放在 SW 内存里做并发去重（SW 重启会丢，需先 `hasDocument()` 复查）。

**UNLOAD 为什么不存在**：文档内部的"释放引用"到不了进程消失的程度，真正有效的释放
就是 `closeDocument()` 销毁整个文档。所以 S2 的"关闭全局 AI"直接销毁文档即可。

> 注意：`chrome.offscreen.createDocument` 只允许**一个** offscreen 文档；与其他潜在用途（未来若要做系统通知等）互斥，需在代码注释中标注占用。

### 3.2 消息协议（扩展 `src/core/messages.ts`）

```ts
// 既有：PASTE_DETECT / PasteDetectResponse 保留（正则档立即回包）

// 新增：SW ↔ offscreen
export const MODEL_HOST_PORT = 'pg-model-host'
export interface ModelHostDetectRequest {
  op: 'DETECT'
  token: string
  text: string
  profile: ProfileConfig          // 纯 JSON，可直接序列化（类型见 core/types）
  enableContentDetection: true
}
export interface ModelHostDetectResponse {
  token: string
  ok: boolean
  sanitized?: string
  count?: number
  items?: DetectionItem[]         // 侧栏路径需要 items；粘贴路径只用 sanitized
  error?: string
}

// 新增：content script ↔ SW（挂件）
export const SITE_AI_GET = 'SITE_AI_GET'     // { pattern } → { global, site, hostReady }
export const SITE_AI_SET = 'SITE_AI_SET'     // { pattern, enabled }
export const OPEN_SIDE_PANEL = 'OPEN_SIDE_PANEL'

// 新增：SW → tab（AI 二次升级结果）
export const PASTE_AI_RESULT = 'PASTE_AI_RESULT'
```

`PASTE_DETECT` 请求扩展两个可选字段（向后兼容）：

```ts
export interface PasteDetectRequest {
  type: typeof PASTE_DETECT
  text: string
  token?: string        // 有 token 且本站 AI 生效时，SW 承诺后续补发 PASTE_AI_RESULT
  sitePattern?: string  // 供 SW 判定本站 AI 是否生效（也可由 sender.tab.url 推断，优先用 sender）
}
```

### 3.3 侧栏改为客户端

- `useDetectionStore` 的 `initNER()/retryLoadNER()` 改为"请求宿主 ENSURE"，不再 `import preloadModels` 直接调用。
- 模型状态（`nerStatus/nerLoadProgress/nerLoadBytes/nerIndeterminate/nerWaitingOtherWindow/nerDownloadStarted/nerError`）改为**订阅 `chrome.storage.session['contextwatchdog.modelHost']`**，字段一一对应，UI 组件零改动。
- `detectText()` 改为 `runDetection()` 抽象：宿主可用 → 走宿主（拿 `items`）；否则 → 本地 `detect()`（Firefox / 宿主不可用）。宿主的 `items` 与本地完全同构，`replaceConfigs` 初始化逻辑不变。
- `setAiEnabled(false)` → 通知宿主 UNLOAD（释放内存）+ 关闭 offscreen 文档。

### 3.4 页面挂件（控制面，注入函数自包含）

在 `src/background/pasteEntryPoint.ts` 中新增（或拆出 `siteWidget.ts`，保持"自包含、无 import"约束，与 `pasteText.ts` 同步维护可测逻辑）：

```
挂件（默认收起为 44px 圆形按钮 + 白色 mark，右下角，z-index 2147483647）
├─ 展开面板（宽 280px，头部左侧同款白色 mark + 字标）
│   ├─ 行1：本站 AI 增强  [Switch]   副文案：启用后首段粘贴可能慢 1~2 秒
│   └─ 行2：在侧边栏中打开 [按钮]     → 发 OPEN_SIDE_PANEL
└─ 收起（× / Esc / 点击面板外）：仅折叠面板，不写存储，挂件本身常驻
```

实现要点（全部内联样式，禁止依赖宿主页面 CSS，同现有 `showToast` 的做法）：

1. 挂到 `document.documentElement`，避免 SPA 重渲染 `#root` 时被清掉。
2. `MutationObserver` 在挂载时立即启动，自身被移除就重挂；另加 3s 心跳兜住
   `document.open/write` 与 `documentElement` 被整体替换（观察器会随旧节点失效）。
3. 状态初始化：注入时发 `SITE_AI_GET`（携带 `location.origin` 规范化后的 pattern）。
   回包前开关禁用；SW 瞬时不可用**不卸载**挂件（保持禁用态），只有页面卸载才消失。
4. 全局 AI 关闭时，Switch 显示为禁用并附文案"需先在侧边栏开启 AI 模型"。
5. 挂件与粘贴监听共用同一个 `__contextWatchdogInstalled` 守卫（同一次注入调用完成两件事）。
6. **不新增权限**：授权站点本来就有 host permission；挂件不发起网络请求。
7. 品牌 mark 随 `args` 传入：SW 用 `?raw` 读 `public/icons/logo.svg`、把墨色换成白色
   （挂件底色是深色），注入侧用 `DOMParser` 解析落地。不走 `<img src>`/`fetch`——
   宿主页面 CSP 的 `img-src` 可能直接拦，扩展资源还得进 `web_accessible_resources`。
   换 logo 只改资产一处，挂件与工具栏图标一起更新。

### 3.5 粘贴链路的 AI 二次升级（状态机）

仅 `input/textarea` 路径；contenteditable 本期**保持正则档**（`preventDefault` + 选区快照已有阻塞语义，再加秒级延迟会变成可感卡顿，且 `execCommand` 回插的成功率随延迟下降）。

```
P0 paste 事件（已存在）
 └─ 乐观插入原文 → setTimeout(0) → computeInsertionRange 校验（已存在，不变）
P1 发 PASTE_DETECT{ text, token }
P2 SW 正则档 detect() → sanitizeText() → 立即回 { ok, sanitized, count }（体验同今天，ms 级）
P3 content script 就地把插入区间替换为 sanitized，记录：
     appliedText / appliedRange / elementValueAfterApply / token
     toast = 「已脱敏 N 处」
P4 SW（仅当 本站AI生效 && hostReady && token 存在）异步发起宿主 DETECT（同 original text）
P5 宿主返回 → SW 发 PASTE_AI_RESULT{ token, sanitized: aiSanitized, count }
P6 content script 守卫（全部通过才替换）：
     a) el.value === elementValueAfterApply        （用户没继续输入）
     b) el.value.slice(appliedRange) === appliedText（正则结果仍在原位）
     c) aiSanitized 与 appliedText 不同              （AI 确实多检出）
     d) 距 P3 不超过 AI_UPGRADE_TTL（建议 8000ms）
   → 通过：替换区间 + 光标修正 + toast 改「AI 增强后共脱敏 N 处」
   → 不通过：丢弃升级（**保留正则结果，绝不回退成原文**）
```

设计红线：

- **AI 路径永不阻塞首答**：正则结果先落地，AI 是增量。
- **升级失败 = 保持正则结果**，不产生"粘贴了但没脱敏"的静默失效（正则档保证下限）。
- 超时（8s）只丢弃 AI，不影响已生效的脱敏。

---

## 4. 数据与存储

| key | 区域 | 值 | 说明 |
|---|---|---|---|
| `contextwatchdog.aiEnabled` | local | boolean | 既有全局开关，语义变为"允许使用 AI" |
| `contextwatchdog.siteAiEnabled` | local | `Record<pattern, boolean>` | 新增，逐站开关 |
| `contextwatchdog.modelHost` | **session** | `{ state, percent, received, total, waiting, downloadStarted, error, updatedAt }` | 新增，宿主经 Port 上报、**SW 代写**（宿主只有 `chrome.runtime`）；面板订阅 `storage.onChanged` 渲染 |
| `contextwatchdog.modelLock` / `lastModelProbe` | local | — | 既有，宿主复用 |

有效 AI 判定：`effectiveAI(site) = aiEnabled && siteAiEnabled[site] && hostReady`。

> `storage.session` 默认 `TRUSTED_CONTEXTS`，SW/扩展页/offscreen 均属可信上下文，无需 `setAccessLevel`。写频率沿用下载器 1s 心跳节流（`HEARTBEAT_THROTTLE_MS`）。

---

## 5. 失败与降级矩阵

| 场景 | 行为 |
|---|---|
| 用户未开全局 AI | 不创建 offscreen；粘贴走正则（现状） |
| 站点未开 AI | 走正则；挂件 Switch 为关 |
| 宿主正在下载模型 | 面板显示下载进度（复用现有 UI）；粘贴走正则，`SITE_AI_GET.hostReady=false` |
| 模型加载失败/超时 | 面板显示错误 + 重试（现状 UI）；宿主状态写 session，粘贴恒走正则 |
| `createDocument` 失败 | 记 warning + `hostReady=false` → 永久降级为 `LocalHost`？**否**：直接降级为正则档，并在面板给出"AI 不可用"提示（不静默） |
| SW 被终止重启 | 宿主不受影响；SW 重新 `hasDocument()` 探测 + `PING` 恢复；下载锁/缓存已持久化 |
| 宿主被浏览器回收 | `hasDocument()` 为 false → 重建文档并 ENSURE（缓存命中，秒级恢复） |
| 二次升级超时/守卫失败 | 丢弃 AI，保留正则结果 |
| Firefox | `LocalHost`（侧栏内加载，现状），侧栏手动检测可用；粘贴链路的 AI 二次升级不可用（SW 访问不到侧栏模型）；`siteWidget` 仍可用 |

---

## 6. 安全与隐私

1. **不新增任何权限**：`offscreen` 是唯一新增权限项；仍不申请 `host_permissions`（页面注入走用户逐站授权的 `optional_host_permissions`）。
2. **数据不出设备**：宿主只做本地推理；模型下载走既有白名单源（ModelScope/HF）。
3. **挂件文案必须显示成本**："启用后首段粘贴可能慢 1~2 秒"，并说明模型为本地运行。
4. **contenteditable 与 password**：沿用现有双保险（`isTextEditable` 排除 password；contenteditable 本期不接 AI）。
5. **超长守卫不变**：`MAX_PASTE_CHARS=20000` 在入口层（`pasteEntryPoint.ts:147`）与 SW 侧（`service-worker.ts:101`）保持一致；AI 路径同样受此限制，且级联本身还有 20 段/8000 字上限。

---

## 7. 构建与打包改动

1. `vite.config.ts`：给 `build.rolldownOptions.input` 增加
   `offscreen: resolve(EXT_ROOT, 'src/offscreen/index.html')`
   （CRXJS 只按 manifest 发现入口，offscreen 页面不由 manifest 声明，必须显式加入 input；
   **Vite 8 下写 `rollupOptions.input` 会被静默丢弃**——实测产物里根本没有这个页面，
   没有任何警告。产物路径 `dist/src/offscreen/index.html`。）
2. `src/manifest.json`：`permissions` 增加 `"offscreen"`。
3. `scripts/postbuild.mjs`（Firefox）：
   - 移除 `offscreen` 权限（Firefox 无此权限，审核会标）。
   - Firefox 目标不产出 offscreen 入口（`vite.config.ts` 按 mode 排除），因此不会多一份运行时。
4. CSP 无需改动：`extension_pages` 已含 `wasm-unsafe-eval` 与 `connect-src https:`（`manifest.json:39`），offscreen 页面继承同一策略。
5. 构建体积（**实测**）：入口 chunk 2.2KB；ORT / transformers / gliner 与侧栏共用同一批
   chunk（不重复打包），`dist` 总体积仍为 12MB。原先担心的"双份模型运行时"不成立，
   无需 `manualChunks`。

---

## 8. 测试与验证

**单测（vitest，node 环境）**

- `modelHostState` 纯函数：状态归并（loading→ready/error/timeout）、进度字段映射（与 store 现有语义一致）。
- AI 二次升级状态机（把 §3.5 的 P3–P6 守卫抽成纯函数放 `src/content/pasteText.ts`，与注入副本同步）：
  - 守卫 a/b/c/d 各自失败 → 返回"丢弃升级"；
  - 成功 → 返回替换后的文本与光标位置；
  - 断言"AI 升级失败时结果 === 正则结果"。
- 有效 AI 判定 `effectiveAI(site)`（全局 x 站点 x 宿主就绪的真值表）。

**回归**

- `npm run typecheck`、`npx vitest run`（当前基线 360 项）、`npm run build`（零警告）、`npm run probe:layout`（85 项）、`npm run probe:widget`（11 项）必须全绿。
- 新增探针断言（扩 `scripts/probe-layout.mjs` 或新脚本）：
  - 挂件在授权站点渲染、无授权站点不渲染；
  - 挂件不影响页面布局（不产生滚动条、不遮挡输入框，可用简易碰撞检测）。

**手动验收（Chrome，`npm run build` + 加载 `dist/`）**

1. 未开全局 AI → 无 offscreen 进程（`chrome://extensions` 的进程列表/`chrome://inspect`）。
2. 开全局 AI → 出现 offscreen 文档；下载完成后 `storage.session` 状态为 ready。
3. 站点挂件开 AI → 粘贴一段含姓名/地址的文本：正则结果**立即**出现，随后被 AI 结果替换（toast 文案更新）。
4. 粘贴 20KB 长文本 → 正则先落地；AI 超时则保留正则结果（不出现"未脱敏"）。
5. AI 生效期间在输入框继续打字 → 升级被放弃、已脱敏结果保留。
6. 关闭全局 AI → offscreen 文档被关闭，内存回落。
7. Firefox 构建 → 侧栏内加载模型，功能可用（AI 仅侧栏路径）。

**性能记录（写入 PR 描述）**

- 首答延迟（正则回包）：应维持现状量级（ms 级）。
- AI 升级延迟：记录 25KB / 155KB / 516KB 三档从 P3 到 P6 的耗时。
- 内存：宿主就绪后 offscreen 进程 RSS；与"侧栏自己加载"方案对比（验证 §7 的重复打包/重复内存是否可接受）。

---

## 9. 分阶段实施与检查点

| 阶段 | 内容 | 检查点（全部通过才进下一步） |
|---|---|---|
| **S1 宿主骨架** ✅ | offscreen 入口 + `MODEL_HOST_PORT` + ENSURE/DETECT/PING；manifest/vite 改动 | 已实测（Chrome for Testing + `--load-extension dist`）：文档可创建、模型可加载（183MB，进度上报）、DETECT 回包含正则 + 模型双来源 items、`closeDocument` 后文档消失；Firefox 构建不含 offscreen 入口与权限 |
| **S2 侧栏改客户端** | store 订阅 `storage.session`；`runDetection()` 抽象 + 本地回退 | 面板下载进度/错误 UI 行为与今天一致（含 60s 停滞超时、另一窗口下载中） |
| **S3 粘贴 AI 升级** | `PASTE_DETECT.token` + `PASTE_AI_RESULT` + 守卫状态机（含纯函数单测） | 手动验收 3/4/5 通过；单测覆盖守卫失败路径 |
| **S4 页面挂件** | 注入挂件 + `SITE_AI_GET/SET` + `siteAiEnabled` | 挂件在授权站点可用、无授权站点零接触；不影响页面布局 |
| **S5 收尾** | 文案（延迟提示）、内存回落验证、探针扩展、文档更新（spec.md 的"已知限制"改写） | 全量回归 + 手动验收 1–7 |

---

## 10. 风险与待验证项

| 风险 | 等级 | 处置 |
|---|---|---|
| **内容脚本能否实例化 WASM（受页面 CSP 限制）** | 中 | **需实测**。这条不是方案的前置条件（方案已不放页面内），但会影响"挂件里能不能做本地兜底检测"。切执行模式后可用带严格 CSP 的测试页 + 加载扩展验证，约 10 分钟 |
| offscreen 文档与其他潜在用途互斥（只允许一个） | 低 | 代码注释显式占用声明；未来若需第二个用途，改为"类型路由" |
| 双份模型运行时（侧栏 + offscreen 打包）导致体积/内存增长 | ~~中~~ 已排除 | 实测：入口 chunk 2.2KB，ORT/transformers 与侧栏共用同一批 chunk；S2 后侧栏不再自己加载，运行时只有一份 |
| SW 与宿主的连接在 SW 重启后断裂 | 中 | `hasDocument()` + `PING` 重连；端口重连要幂等（避免重复 ENSURE 重复下载——已由 `createSingleFlight` + 下载锁兜住） |
| 挂件被宿主站点移除/样式冲突 | 低 | 全内联样式 + `documentElement` 挂载 + MutationObserver 重挂 |
| 二次升级守卫过于严格导致 AI 几乎不生效 | 中 | 记录"升级成功率"日志与手动用例；必要时放宽 TTL/守卫（但不得放宽"不改动用户新输入"） |
| Firefox 无 offscreen，能力不一致 | 中 | 文档明示"AI 粘贴增强仅 Chrome/Edge"；Firefox 保留侧栏内加载 |
| `storage.session` 高频写 | 低 | 沿用 1s 节流；仅在字段变化时写 |

---

## 11. 与既有代码的具体改动清单

**新增**

- `src/offscreen/index.html`、`src/offscreen/host.ts`
- `src/modelHost/protocol.ts`（端口名 / op / 请求与回包类型 / 状态通知 / 类型守卫）
- `src/modelHost/state.ts`（状态归并纯函数，已测）
- `src/modelHost/client.ts`（SW 侧客户端：`ensureModelHost()` / `detectViaModelHost()` /
  `pingModelHost()` / `closeModelHost()` / `readModelHostState()`）
- `src/content/siteWidget.ts`（挂件逻辑的可测纯部分）+ 注入副本（自包含）

**修改**

- `src/manifest.json`（+`offscreen` 权限）
- `vite.config.ts`（+offscreen input，写在 `rolldownOptions.input`）
- `scripts/postbuild.mjs`（Firefox 移除 `offscreen` 权限）
- `src/modelHost/protocol.ts`（协议常量与类型）—— 已落地，路径不是原先设想的 `src/core/`
- `src/background/service-worker.ts`（路由器：正则档回包 + 宿主转发 + `PASTE_AI_RESULT` 补发 + offscreen 生命周期）
- `src/background/pasteEntryPoint.ts`（挂件注入；`token` 透传；`PASTE_AI_RESULT` 监听与守卫）
- `src/content/pasteText.ts`（抽取升级守卫纯函数 + `effectiveAI` 判定）
- `src/stores/detection.ts`（`runDetection()` 抽象；模型状态改为 session 订阅；`setAiEnabled` 联动宿主）
- `docs/spec.md`（§已知限制改写；补 offscreen 宿主与逐站 AI 说明）

**测试**

- `tests/unit/modelHost.test.ts`、`tests/unit/siteAi.test.ts`、扩展 `tests/unit/pasteRewrite.test.ts`
- `scripts/probe-layout.mjs`（或新 `scripts/probe-widget.mjs`）
