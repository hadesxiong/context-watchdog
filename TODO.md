# 检测引擎重构计划

> **状态更新（Phase 1-3 已完成，commit 7e8bbbe + Phase 3）**
>
> 本文档为历史规划，大部分条目已实施或被取代。当前实际架构见 `README.md`：
> - §1-§9 的五步管线 / MobileBERT 场景模型 / valueExtractor → **已被取代**：场景改为启发式（sceneDetector.ts），valueExtractor 被 kvRules.ts 取代（文件已删除），GLiNER 改为级联触发（仅处理正则未覆盖片段）
> - §15 Case 6 修复 → **已完成**（Phase 1，含额外修复：独立连接串规则死代码、env 跨行吞值、高熵吞整行）
> - 新增（Phase 1-3）：重复值泄漏修复、重叠归并仲裁、EMAIL/PII 规则、Profile 层（不限/通用文本/代码开发）、语义化中文占位符、vitest 测试套件（50 项断言）
> - 新增（Phase 4）：用户自定义档案（类别开关/灵敏度/分类型策略/白名单/GLiNER 标签）、CRUD 持久化、白名单管线过滤
> - 新增（Phase 5）：自定义正则规则（ReDoS 双层防护：静态嵌套量词拒绝 + 50ms 运行时预算）、档案 JSON 导入导出（剪贴板）、测试扩至 88 项断言
> - **五阶段规划全部完成**
>
> 以下原文仅作历史参考。

---

## ✅ 代码侧复核（UI/UX 阶段；2 项仍待实机）

> 状态：代码全部完成并通过 `npm run typecheck` / `npm test`（104 断言）/ `npm run build`（零警告）。
> 模型源已由 hf-mirror 切换为 ModelScope（hf-mirror 现为 308 跳转且无 ACAO，扩展页 fetch 必失败），
> 并补齐断点续传 / 缓存落盘 / 进度心跳 / 单飞重试（详见 B 组复核说明）。
> **勾选标准（2026-10-16）**：代码实现 + 三类证据至少其一（静态核对 / 单测 / curl 实测）→ 打勾；
> 必须真机运行才能判定的（视觉节奏、真实模型推理效果）保持 `[ ]`。
> 实机验证方式：`npm run build` → Chrome 扩展页重新加载 `dist/`（不要用 `npm run dev`）。

### A. UI/主题（shadcn 化 + Logo + 弹窗）

> **代码侧证据（2026-10-16）**：
> `src/style.css:34` `@media (prefers-color-scheme: dark)` 暗色令牌 ・ `src/ui/Logo.vue` 盾牌+四点掩码 SVG
> （配色用 `var(--foreground/--background)` 主题变量）・ `src/ui/Dialog.vue` 基于 reka-ui：右上角 × 显式关闭
> （`@click="onOpenChange(false)"` + `sr-only` 标签），Esc / 点遮罩为 reka-ui `DialogContent/Overlay` 内置行为；
> `src/components/ProfileTabs.vue:47`「＋」按钮已接线 ・ `src/components/DetectionList.vue:51-63` 空结果绿色对勾 ・
> `src/sidepanel/App.vue:254 / 292 / 314` 三个 NER 浮窗均为 `fixed z-50 bg-card rounded-lg shadow-lg` 且位于 header 下方
> （另有 151 行「检测中」浮窗层级一致）・ `App.vue:76-95` 三引擎卡片 + 开关；全 `src` 仅 `contentDetector.ts` 一处网络入口
> → AI 关闭即零网络。
> 未勾项：**间距统一**为纯视觉节奏，只能目视判定；**明暗主题**发现 1 处硬编码残留 `Switch.vue:65 bg-white`（开关把手，
> 明暗下均可见故不影响使用）→ 已按遗留项 B-5 修复为 `bg-background`（深色观感待实机复核）。

- [x] **明暗两套主题**：跟随系统 `prefers-color-scheme` 切换；检查 header、Tab、检出卡片、设置面板配色无硬编码残留（指定范围内无残留；唯一发现的 `Switch.vue:65 bg-white` 已改为 `bg-background`）
- [x] **Logo**：header 左上角应为「盾牌+四点掩码」SVG（非蓝色方块）；工具栏图标（16/32/48/128 PNG）正常显示（SVG 与 4 个 PNG 均在 `src/ui/Logo.vue` / `dist/icons/`；PNG 显示效果待目视）
- [x] **配置弹窗**：「＋」新建自定义档案 → 居中 Dialog 弹出（遮罩 + 淡入缩放动画），Esc / 点遮罩 / 右上角 × 均可关闭；表单保存/取消/删除正常（`pg-dialog-in/out` 关键帧 + reka-ui 内置 Esc/遮罩关闭 + 显式 ×）
- [ ] **间距统一**：Tab 区（`px-3 pt-3`）与输入区、右列 `p-3` 左对齐、垂直节奏一致（**需目视**，代码类名已核）
- [x] **空结果提示**：输入无敏感信息文本（如"今天天气不错"）→ 右列显示绿色对勾「未检测到需要替换的内容」（而非整列消失）（`DetectionList.vue:51-63`）
- [x] **浮窗层级**：三个 NER 浮窗（加载/失败/成功）为 `z-50` + 不透明 `bg-card` + `shadow-lg`，固定出现在 header 下方，不与任何内容重叠或"融为一体"（`App.vue:254/292/314`，失败与超时共用一个浮窗）
- [x] **引擎状态面板**（右上 ℹ）：三引擎状态卡片 + AI 增强开关；开关关闭时零网络请求、控制台零报错（全 `src` 仅 `contentDetector.ts` 一处 `fetch(`）

### B. NER 模型下载（本轮修复重点，代码侧已完成，B-5 需真机推理验证）

> **代码侧复核（2026-10-16）：B 组 6 项代码均已具备，另有 4 处真缺陷本轮已补**
>
> 1. **源站**：`hf-mirror.com` 已弃用 —— 它现在对 `/resolve/` 一律 `308 → huggingface.co` 且响应**不带
>    `Access-Control-Allow-Origin`**，Fetch 规范对重定向链逐跳做 CORS 校验，扩展页（无 `host_permissions`）
>    第一跳即 `TypeError: Failed to fetch`，界面文案正是「网络请求被阻止或模型下载失败」。
>    主源改为 `modelscope.cn/models/{id}/resolve/{rev}/...`（302 带 `ACAO: *`，末端 CDN 183,403,734 字节、
>    支持 `Range`、实测约 14MB/s），`huggingface.co` 作兜底轮换。
> 2. **新增 `src/core/detector/modelDownload.ts`**：Range 断点续传、指数退避重试（尊重 `Retry-After`、封顶 16s）、
>    停滞看门狗（30s 无字节即中断、下次从断点续）、传输完整性校验（没下全不入缓存）、Cache Storage 落盘（重开侧栏零下载）。
> 3. **修假超时**：原先无 `Content-Length` 时只在开始上报一次进度，60 秒后必然误判超时；现改为逐块上报心跳，
>    只要还有字节进来就续期。
> 4. **修重试无效**：加载改单飞门闩（`createSingleFlight`），卡住后点重试复用在飞加载的真实结果，
>    不再「假成功 / 永久卡 loading」；成功状态额外以 `isContentModelReady()` 断言。
> 5. `manifest.json` 增加 `unlimitedStorage`（183MB 模型缓存配额）。
> 6. 未知总长时进度显示「已下 xx.x / 183 MB」而非空转。
>
> 单测 `tests/unit/modelDownload.test.ts`（16 断言）：续传偏移、源站忽略 Range、偏移不匹配重置、429 退避、
> 停滞看门狗、完整性截断、缓存命中零网络、全源失败轮换、单飞门闩。

- [x] **404 已修**：`MODEL_URL` 已改为 `onnx/model_quantized.onnx`（原根目录 `model.onnx` 不存在）；控制台不应再出现 `模型下载失败：HTTP 404`（证据：`MODEL_SOURCES` 指向 ModelScope/HF 的 `onnx/model_quantized.onnx`，curl 实测 200 / 183,403,734 字节）
- [x] **真实进度**：开关打开 → 浮窗进度条按真实字节推进 0→100%（约 183MB int8 量化版，不再是"假进度卡 90%"）（证据：`progressPercent` 按 `content-length` 逐块计算，单测覆盖单调性与封顶 99；未知总长时 UI 显示「已下 xx.x / 183 MB」）
- [x] **停滞超时**：只要进度在动就不会超时；真正 60 秒无进展才弹黄色「加载超时」toast + 重试按钮（证据：每次进度回调都 `resetTimeout()`；下载侧另有 30s 停滞看门狗，单测覆盖）
- [x] **失败路径**：断网开启开关 → 黄色「NER模型加载失败」toast 立即出现（原 bug：旧变量 `nerRetryCount` 恒为 0 导致永远卡 loading；该变量已于遗留项 B-3 删除）；点重试可恢复（证据：`createSingleFlight` 单测——并发复用同一 promise、失败后释放门闩；`loadContentModel` 重试复用在飞加载的真实结果）
- [ ] **就绪路径**：下载完成 → 绿色「NER模型已就绪」toast，引擎面板「AI 模型」变"生效"；输入含姓名/地址文本验证 AI 增强检出（代码侧：成功前断言 `isContentModelReady()` 杜绝假成功、`engineStatus.contentModel` 置位；**后半句需真机跑模型推理**，保持未勾）
- [x] **开关关闭**：关闭 AI 增强 → 回退纯正则检测，状态复位（证据：`setAiEnabled(false)` 复位进度/字节/总长/引擎状态；`pipeline` 的 `shouldRunNER` 依赖 `nerStatus==='success'`）

### C. 回归（每次验证前跑一遍）

```bash
npm run typecheck && npm test && npm run build   # 期望：0 error / 104 passed / 0 warnings
```

**已知限制**：`hf-mirror.com` 已弃用（308 且无 ACAO，任何扩展页场景都不要再接入）。ModelScope 侧若遇 CDN 限流
（429/503），下载器会按 `Retry-After` 指数退避并轮换到 `huggingface.co`，共 5 次；全部失败才报错，届时才属源站问题。

---

## 🧭 遗留项（2026-10-16 盘点；A、B、C 三组均已于 2026-10-17 实施完成）

> 来源：本轮修复后仍存在的能力缺口 + 代码卫生 + 产品方向。A、B、C 三组已实施并有单测/构建证据；
> 仅 C-4（新权限提示）与 A-4（heap 实测）需真机观察后回填。

### A. 模型下载健壮性（跨会话 / 多实例）

- [x] **跨会话断点续传**（A-1，2026-10-17）：部分文件持久化到 Cache Storage（`MODEL_PARTIAL_URL = ?partial`），元数据存条目响应头（`x-model-bytes/total/etag/source/saved-at`）；读取时三重一致性校验（实际字节 = 头声明 = content-length，不符即丢弃，绝不拼脏数据）。续传只在「同源 + 强 etag」时才发 `If-Range`（弱 etag / 跨源不发，跨源靠 `content-range.total` 不匹配时重置基准）。单测覆盖：跨会话续传、跨源续传与重置、源站忽略 Range、偏移不匹配、全部失败保留部分文件。
- [x] **多窗口并发去重**（A-2，2026-10-17）：`chrome.storage.local` 单键锁 `pasteguard.modelLock`（owner + 30 秒心跳 TTL + 进度），抢不到锁的窗口进入等待：转发对方进度到 UI、显示「另一窗口下载中」，对方写完缓存即直接命中（全程零网络）；锁过期（关面板/崩溃）则接管，接管路径再查一次缓存避免重复下载。等待上限 200 轮 ×1.5s ≈ 5 分钟，超时自行下载（正确性不受影响，只多耗带宽）。未改 background SW。单测覆盖：锁抢占/过期接管/心跳权限、等待方零网络命中、过期接管。
- [x] **缓存版本号自动化**（A-3，2026-10-17）：缓存 key 固定为 `.../model_quantized.onnx`（不再带 `?v=`），ETag/长度/时间写进条目响应头；命中缓存后先做 1 字节探测（`Range: bytes=0-0`，5 秒超时，双源依次，正文立即丢弃）比对 ETag → 长度兜底：一致/无法比较/离线一律沿用缓存（离线优先），确认过期才清缓存重下。旧 key `?v=183403734` 命中时一次性搬迁，升级用户不重下 183MB。单测覆盖：探测取值与全源失败、离线降级、远端更新触发重下。
- [x] **内存峰值**（A-4，2026-10-17，轻方案）：`runLoad` 持本地 `onnxSettings` 引用，`initialize()` 后置空 `modelPath`，断开 gliner 实例对 183MB ArrayBuffer 的引用（ORT session 已持有 wasm 堆副本，推理不受影响）；并加 JS 堆快照日志 `[PasteGuard] 内存快照（模型下载完成 / 初始化完成并释放模型引用）`。**实测峰值数据待实机复核后回填此条。**

> 注：tokenizer / config / spm.model 由 gliner 内部的 `@xenova/transformers` 下载，走它自己的 `transformers-cache`
> 与 HTTP 缓存，不受本节 `?v=` 版本号管理；且 `transformers.env` 是**全局**设置，未来若出现第二处 transformers
> 用途会互相影响。

### B. 代码卫生（低风险清理）

- [x] **废弃文件处置**（B-1，2026-10-17）：已按拍板结论直接删除 `nerDetector.ts` / `semanticRules.ts` / `connectionString.ts`（未归档）；§1.3 表格与 §2.2 已同步。
- [x] **删除兼容导出 `preloadNER`**（B-2，2026-10-17）：`src/core/detector/index.ts` 中已删除。
- [x] **删除死变量 `nerRetryCount`**（B-3，2026-10-17）：声明 / 复位 / 导出三处已删除。
- [x] **补 store 状态机单测**（B-4，2026-10-17）：新增 `tests/unit/detectionStore.test.ts` 6 用例（加载成功、`isContentModelReady()` 假成功断言、60 秒停滞超时、进度重置超时与字节/不定进度映射、`setAiEnabled(false)` 复位、另一窗口等待标记）。
- [x] **清理硬编码颜色**（B-5，2026-10-17）：`src/ui/Switch.vue` 开关把手 `bg-white` → `bg-background`（深色主题观感待实机复核）。

### C. 产品 / 工程方向（2026-10-17 拍板并实施）

- [x] **粘贴自动拦截**（C-1，2026-10-17）：按拍板结论实现——**先插入后就地替换**（不阻塞输入）、**SW 跑正则管线**（GLiNER 不在 SW 加载，面板不必开着）、**逐站授权**（`optional_host_permissions` + `chrome.permissions.request`，不申请 `<all_urls>`）。实现：`core/sites.ts`（站点规范化/匹配）、`core/messages.ts`（PASTE_DETECT 契约）、`content/pasteText.ts`（插入区间推导与改写守卫，纯函数有单测）、`background/pasteEntryPoint.ts`（自包含注入函数）、`background/service-worker.ts`（检测服务 + `tabs.onUpdated` 按需注入 + 站点列表变化即注入已开页面）、`components/PasteInterceptionSettings.vue`（添加/移除站点 UI）。护栏：password/隐藏框绝不处理、插入文本与剪贴板逐字吻合才改写、检测期间用户继续输入则放弃改写、超 20000 字符直接放行。**已知限制**：仅支持 `input[type=text/search]` 与 `textarea`，`contenteditable` 富文本区域暂不处理（待后续版本）；自动拦截为正则档，AI 增强只在侧栏手动流程生效。单测：`sites.test.ts` 11 例 + `pasteRewrite.test.ts` 6 例。
- [x] **收紧 CSP**（C-2，2026-10-17）：`manifest.json` 的 `extension_pages` CSP 由 `connect-src 'self' https: http: ws:` 收紧为 `connect-src 'self' https:`（模型与 tokenizer 全走 https；代码中无 WebSocket 使用）。`script-src 'self' 'wasm-unsafe-eval'` 保留（ORT WASM 必需，Firefox MV3 亦要求显式声明）。
- [x] **跨浏览器兼容**（C-3，2026-10-17，最小方案）：同一份 `dist/` 兼容 Firefox 121+——manifest 增加 `sidebar_action`（打开同一 sidepanel 页面）与 `browser_specific_settings.gecko`；SW 内运行时探测 `chrome.sidePanel.open` → 失败回退 `chrome.sidebarAction.open`；`background` 同时声明 `service_worker` 与 `scripts`（CRXJS 会丢弃 `scripts`，由新增 `scripts/postbuild.mjs` 在构建后注回，Chrome 121+ 忽略多余键）。**待实机**：Firefox 加载/侧栏打开/粘贴注入/CSP 四项均需在 Firefox 中人工验证。
- [ ] **新权限体验确认**（C-4）：本轮又新增 `scripting` 权限与 `optional_host_permissions`（可选，运行时按站点申请）。**待实机**：扩展更新后确认 Chrome 是否弹权限提示、文案是否可接受；粘贴拦截的站点授权弹窗观感如何。

## 1. 架构总览

### 1.1 五步检测流程

```
输入文本
  │
  ▼
┌─────────────────────────────────┐
│  Step 1: 场景识别               │
│  MobileBERT (21 MB)             │
│  输出: yaml / env / code / log  │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Step 2-4: 内容检测             │
│  GLiNER-small (50 MB)           │
│  输出: 实体列表 + 置信度        │
│  ┌─────────┬─────────┬─────────┐│
│  │ >0.8    │ <0.3    │ 0.3-0.8 ││
│  │ →敏感   │ →不敏感  │ →不确定 ││
│  └────┬────┴────┬────┴────┬────┘│
└───────┼─────────┼─────────┼─────┘
        │         │         │
        ▼         ▼         ▼
     替换内容  保留原样  按值拆分 → 正则
        │                   │
        │    ┌──────────────┘
        │    │
        ▼    ▼
┌─────────────────────────────────┐
│  Step 5: 正则辅助               │
│  - 检查 Step 2 结果（验证）     │
│  - 处理 Step 4 不确定内容      │
└─────────────────────────────────┘
```

### 1.2 模型选型

| 角色 | 模型 | 大小 | 包 | 延迟 |
|------|------|------|----|----|
| 场景识别 | `Xenova/mobilebert-uncased-mnli` | ~21 MB | `@xenova/transformers` | ~15-30ms |
| 内容检测 | `nexuswho/gliner-onnx-small` | ~50 MB | `@lmoe/gliner-onnx` | ~100-200ms |

**总大小**: ~71 MB（远低于 150 MB/个的上限）

### 1.3 技术栈变化

| 当前 | 变化 |
|------|------|
| `@xenova/transformers` v2.17.2 | 保留，用于场景识别 |
| `onnxruntime-web` | 新增，GLiNER 依赖 |
| `@lmoe/gliner-onnx` | 新增，GLiNER TypeScript 封装 |

> 曾计划「废弃保留」的 `nerDetector.ts` / `semanticRules.ts` / `connectionString.ts` 已于遗留项 B-1 直接删除（2026-10-17）。

---

## 2. 文件结构变化

### 2.1 新增文件

```
src/core/detector/
├── sceneDetector.ts      # 新：场景识别（MobileBERT 零样本分类）
├── contentDetector.ts    # 新：内容检测（GLiNER 密钥检测）
├── valueExtractor.ts     # 新：按值拆分逻辑
├── pipeline.ts           # 新：五步检测管线入口
└── index.ts              # 重写：调用新管线
```

### 2.2 废弃文件（已于 2026-10-17 删除）

`nerDetector.ts` / `semanticRules.ts` / `connectionString.ts` 原记为「保留但不再使用」，
后按遗留项 B-1 的拍板结论**直接删除**（全项目 0 引用；历史版本见 git）。

### 2.3 保留文件

```
src/core/detector/
├── regexRules.ts         # 保留：正则辅助规则（Step 5）
```

---

## 3. Step 1: 场景识别

### 3.1 场景类型定义

```typescript
// src/core/detector/sceneDetector.ts

export type SceneType = 
  | 'yaml'        // YAML 配置（Docker Compose, K8s, CI/CD）
  | 'env'         // 环境变量文件
  | 'code'        // 源代码（Python, JS, TS 等）
  | 'log'         // 日志文件
  | 'json'        // JSON 数据
  | 'plain'       // 纯文本

export interface SceneResult {
  type: SceneType
  confidence: number
  scores: Record<SceneType, number>
}
```

### 3.2 零样本分类实现

```typescript
// 使用 MobileBERT 零样本分类
const SCENE_LABELS = [
  'YAML configuration file with key-value pairs',
  'environment variables file with KEY=VALUE format',
  'source code with functions and imports',
  'log file with timestamps and messages',
  'JSON data file',
  'plain text'
]

// 模型输出映射
const LABEL_MAP: Record<string, SceneType> = {
  'YAML configuration file with key-value pairs': 'yaml',
  'environment variables file with KEY=VALUE format': 'env',
  'source code with functions and imports': 'code',
  'log file with timestamps and messages': 'log',
  'JSON data file': 'json',
  'plain text': 'plain'
}
```

### 3.3 实现要点

- 使用 `@xenova/transformers` 的 `pipeline('zero-shot-classification', ...)`
- 模型: `Xenova/mobilebert-uncased-mnli`（21 MB，量化后）
- 延迟: ~15-30ms（WASM，单线程）
- 首次加载: ~500ms（含模型下载）

---

## 4. Step 2-4: 内容检测

### 4.1 GLiNER 实体类型

```typescript
// src/core/detector/contentDetector.ts

// 密钥相关实体类型（GLiNER 零样本标签）
const SECRET_LABELS = [
  'password',
  'secret',
  'api_key',
  'access_token',
  'connection_string',
  'database_credentials',
  'private_key',
  'jwt_token',
  'aws_access_key',
  'aws_secret_key',
  'credential',
  'token'
]

// 置信度分类阈值
const CONFIDENCE_THRESHOLDS = {
  SENSITIVE: 0.8,      // > 0.8 → 显然敏感
  UNCERTAIN: 0.3,      // < 0.3 → 显然不敏感
  // 0.3 - 0.8 → 不确定
}
```

### 4.2 GLiNER 检测实现

```typescript
import { GLiNER1ONNXRuntime } from '@lmoe/gliner-onnx'

interface ContentEntity {
  text: string
  startIndex: number
  endIndex: number
  entityType: string
  confidence: number
  scene: SceneType
}

async function detectContent(
  text: string, 
  scene: SceneResult
): Promise<ContentEntity[]> {
  // 加载 GLiNER 模型（首次使用时）
  const model = await loadGLiNERModel()
  
  // 运行实体检测
  const entities = await model.extractEntities(text, SECRET_LABELS, {
    threshold: 0.2,  // 低阈值，捕获更多候选
    multiLabel: true
  })
  
  // 转换为 ContentEntity 格式
  return entities.map(e => ({
    text: e.text,
    startIndex: e.start,
    endIndex: e.end,
    entityType: e.label,
    confidence: e.score,
    scene: scene.type
  }))
}
```

### 4.3 置信度分类

```typescript
type EntityCategory = 'sensitive' | 'not_sensitive' | 'uncertain'

function categorizeEntity(entity: ContentEntity): EntityCategory {
  if (entity.confidence > CONFIDENCE_THRESHOLDS.SENSITIVE) {
    return 'sensitive'      // Step 2: 显然敏感
  }
  if (entity.confidence < CONFIDENCE_THRESHOLDS.UNCERTAIN) {
    return 'not_sensitive'  // Step 3: 显然不敏感
  }
  return 'uncertain'        // Step 4: 不确定
}
```

### 4.4 实现要点

- 使用 `@lmoe/gliner-onnx` 的 `GLiNER1ONNXRuntime`
- 模型: `nexuswho/gliner-onnx-small`（INT8 量化，~50 MB）
- 延迟: ~100-200ms（WASM，单线程）
- 首次加载: ~800ms（含模型下载）

---

## 5. Step 4: 按值拆分

### 5.1 值提取逻辑

根据场景类型提取 value 部分：

```typescript
// src/core/detector/valueExtractor.ts

function extractValue(entity: ContentEntity, scene: SceneType): string {
  const text = entity.text
  
  switch (scene) {
    case 'yaml':
      // "DB_PASSWORD: xxx" → "xxx"
      const yamlMatch = text.match(/^[^:]+:\s*(.+)$/)
      return yamlMatch ? yamlMatch[1].trim() : text
    
    case 'env':
      // "DB_PASSWORD=xxx" → "xxx"
      const envMatch = text.match(/^[^=]+=\s*(.+)$/)
      return envMatch ? envMatch[1].trim() : text
    
    case 'json':
      // '"password": "xxx"' → "xxx"
      const jsonMatch = text.match(/"([^"]+)"\s*:\s*"([^"]+)"/)
      return jsonMatch ? jsonMatch[2] : text
    
    case 'code':
      // "password = 'xxx'" → "xxx"
      const codeMatch = text.match(/^[^=]+=\s*['"]?([^'"]+)['"]?$/)
      return codeMatch ? codeMatch[1].trim() : text
    
    default:
      return text
  }
}
```

### 5.2 去除引号和空白

```typescript
function cleanValue(value: string): string {
  return value
    .replace(/^['"]|['"]$/g, '')  // 去除首尾引号
    .replace(/\s+$/, '')          // 去除尾部空白
}
```

---

## 6. Step 5: 正则辅助

### 6.1 验证 Step 2 结果

```typescript
// src/core/detector/regexRules.ts（保留现有规则）

function validateSensitiveEntity(entity: ContentEntity): boolean {
  const value = entity.text
  
  // 已知 API Key 格式验证
  if (entity.entityType === 'api_key') {
    if (/^(sk-|AKIA|ghp_|xox[baprs]-)/.test(value)) return true
    if (/^[A-Za-z0-9]{20,}$/.test(value)) return true
    return false  // 不符合已知格式，降级
  }
  
  // 连接串格式验证
  if (entity.entityType === 'connection_string') {
    if (/^[a-z]+:\/\/[^\s]+/.test(value)) return true
    return false
  }
  
  // JWT 格式验证
  if (entity.entityType === 'jwt_token') {
    if (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true
    return false
  }
  
  // 其他类型保持原判断
  return true
}
```

### 6.2 处理 Step 4 不确定内容

```typescript
function processUncertainContent(
  value: string, 
  scene: SceneType
): DetectionItem | null {
  // 对不确定的值运行正则规则
  
  // 1. 连接串检测
  const dbMatch = value.match(DB_PASSWORD_REGEX)
  if (dbMatch) {
    return { type: 'DB_PASSWORD', original: value }
  }
  
  // 2. API Key 检测
  const apiKeyMatch = value.match(API_KEY_REGEX)
  if (apiKeyMatch) {
    return { type: 'API_KEY', original: value }
  }
  
  // 3. JWT 检测
  const jwtMatch = value.match(JWT_REGEX)
  if (jwtMatch) {
    return { type: 'JWT', original: value }
  }
  
  // 4. 高熵检测
  if (isHighEntropy(value)) {
    return { type: 'HIGH_ENTROPY', original: value }
  }
  
  // 5. 未匹配任何规则，保留原样
  return null
}
```

---

## 7. 主管线入口

### 7.1 完整流程

```typescript
// src/core/detector/pipeline.ts

import { detectScene } from './sceneDetector'
import { detectContent, categorizeEntity } from './contentDetector'
import { extractValue } from './valueExtractor'
import { validateSensitiveEntity, processUncertainContent } from './regexRules'

export async function detect(
  text: string,
  config: DetectorConfig
): Promise<DetectionResult> {
  // Step 1: 场景识别
  const scene = await detectScene(text)
  console.log('[PasteGuard] Scene:', scene.type, `(${(scene.confidence * 100).toFixed(1)}%)`)
  
  // Step 2-4: 内容检测
  const entities = await detectContent(text, scene)
  
  // 分类
  const sensitive = entities.filter(e => categorizeEntity(e) === 'sensitive')
  const notSensitive = entities.filter(e => categorizeEntity(e) === 'not_sensitive')
  const uncertain = entities.filter(e => categorizeEntity(e) === 'uncertain')
  
  console.log(`[PasteGuard] Entities: ${sensitive.length} sensitive, ${notSensitive.length} not sensitive, ${uncertain.length} uncertain`)
  
  // Step 5a: 验证 Step 2
  const validatedSensitive = sensitive.filter(e => validateSensitiveEntity(e))
  
  // Step 5b: 处理不确定内容
  const uncertainResults: DetectionItem[] = []
  for (const entity of uncertain) {
    const value = extractValue(entity.text, scene.type)
    const result = processUncertainContent(value, scene.type)
    if (result) uncertainResults.push(result)
  }
  
  // 合并结果
  const allItems = [
    ...validatedSensitive.map(toDetectionItem),
    ...uncertainResults
  ]
  
  // 去重 + 排序
  const deduplicated = deduplicate(allItems)
  deduplicated.sort((a, b) => a.startIndex - b.startIndex)
  
  // 生成占位符
  const withPlaceholders = regeneratePlaceholders(deduplicated)
  
  return { items: withPlaceholders, text }
}
```

### 7.2 检测结果类型

```typescript
// src/core/types/index.ts（扩展）

interface DetectionItem {
  id: string
  original: string
  placeholder: string
  startIndex: number
  endIndex: number
  detectionTypes: DetectionType[]
  confidence: 'high' | 'medium' | 'low'
  source: 'model' | 'regex'  // 新增：标记来源
}

type DetectionType = 
  | 'ENV_PASSWORD'
  | 'API_KEY'
  | 'DB_PASSWORD'
  | 'JWT'
  | 'PRIVATE_KEY'
  | 'HIGH_ENTROPY'
  | 'EMAIL'      // 新增
  | 'PHONE'      // 新增
```

---

## 8. 依赖变化

### 8.1 新增依赖

```json
{
  "dependencies": {
    "@xenova/transformers": "^2.17.2",  // 保留
    "@lmoe/gliner-onnx": "^0.2.0",     // 新增：GLiNER TypeScript 封装
    "onnxruntime-web": "^1.17.0",       // 新增：ONNX 运行时
    "pinia": "^4.0.3",
    "reka-ui": "^2.10.4",
    "vue": "^3.5.42"
  }
}
```

### 8.2 潜在冲突

`@lmoe/gliner-onnx` 依赖 `@huggingface/transformers` v3，而当前项目使用 `@xenova/transformers` v2。

**解决方案**：
1. 使用动态 import 分离加载
2. 或升级到 `@huggingface/transformers` v3（`@xenova/transformers` 的新名称）

### 8.3 CSP 兼容性

Chrome 扩展 CSP 限制：
- `onnxruntime-web` 需要 `numThreads: 1`（避免 blob URL worker）
- WASM 后端兼容（不需要 WebGPU）

---

## 9. 实施顺序

### Phase 1: 基础设施（无破坏性变更）

1. 安装新依赖（`@lmoe/gliner-onnx`, `onnxruntime-web`）
2. 创建 `sceneDetector.ts`（场景识别）
3. 创建 `contentDetector.ts`（内容检测）
4. 创建 `valueExtractor.ts`（值提取）
5. 创建 `pipeline.ts`（主管线）

### Phase 2: 集成切换

6. 修改 `src/core/detector/index.ts`（调用新管线）
7. 修改 `src/stores/detection.ts`（适配新 API）
8. 更新类型定义（扩展 `DetectionItem`）

### Phase 3: 清理

9. 废弃旧文件（`nerDetector.ts`, `semanticRules.ts`, `connectionString.ts`）
10. 更新 `package.json`（移除旧依赖，如需要）
11. 更新 `README.md`（反映新架构）

### Phase 4: 测试验证

12. 运行所有测试用例（Case 1-6）
13. 验证性能（<1s 延迟）
14. 验证包大小（<150 MB/模型）

---

## 10. 测试验证

### 10.1 测试用例

| 用例 | 场景识别 | 内容检测 | 正则辅助 | 预期结果 |
|------|---------|---------|---------|---------|
| Case 1: Docker Compose | yaml | 8 项敏感 | 验证通过 | 8 项替换 |
| Case 2: .env | env | 7 项敏感 | 验证通过 | 7 项替换 |
| Case 3: Log | log | 3 项敏感 | 验证通过 | 3 项替换 |
| Case 4: Code | code | 5 项敏感 | 验证通过 | 5 项替换 |
| Case 5: K8s Secret | yaml | 4 项敏感 | 验证通过 | 4 项替换 |
| Case 6: Edge cases | - | 过滤准确 | - | 正确过滤 |

### 10.2 性能指标

| 指标 | 目标 | 实现方式 |
|------|------|---------|
| 单次检测延迟 | < 1s | 并行加载模型，缓存实例 |
| 首次加载 | < 2s | 预加载 + 进度提示 |
| 模型大小 | < 150 MB/个 | 量化模型 |

### 10.3 准确率目标

| 指标 | 目标 | 说明 |
|------|------|------|
| 密钥召回率 | > 95% | 模型 + 正则互补 |
| 误报率 | < 5% | 置信度阈值调优 |
| 场景识别准确率 | > 95% | 零样本分类 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| GLiNER 模型不兼容 | 无法使用 | 回退到 `gliner` 包或手动 ONNX 加载 |
| 版本冲突 | 构建失败 | 动态 import 隔离 |
| 模型下载慢 | 首次使用卡顿 | 进度提示 + 缓存 |
| 检测延迟超标 | 用户体验差 | 并行加载 + 模型缓存 |
| 准确率不达标 | 漏检/误报 | 调优阈值 + 正则兜底 |

---

## 12. 与现有代码的兼容性

### 12.1 不变的部分

- `src/core/replacer/` — 替换引擎不变
- `src/core/replacer/placeholder.ts` — 占位符生成不变
- `src/core/replacer/mapping.ts` — 映射表管理不变
- `src/components/` — UI 组件不变
- `src/sidepanel/App.vue` — 主界面不变

### 12.2 需要适配的部分

- `src/stores/detection.ts` — 调用新管线 API
- `src/core/detector/index.ts` — 重写为调用 `pipeline.ts`
- `src/core/types/index.ts` — 扩展 `DetectionItem` 类型

---

## 13. 待确认问题

1. **GLiNER 模型选择**：`nexuswho/gliner-onnx-small` 是否足够？还是需要更大的模型？
2. **场景分类标签**：当前定义的 6 种场景是否覆盖所有用例？
3. **置信度阈值**：0.8/0.3 的阈值是否合适？需要实际测试调优。
4. **回退策略**：如果模型加载失败，是否回退到纯正则方案？

---

## 14. 总结

### 核心改进

| 当前问题 | 新方案解决方式 |
|---------|--------------|
| YAML `KEY: VALUE` 不识别 | GLiNER 理解缩进结构 |
| 多 `@` 截断 | GLiNER 理解连接串整体 |
| 注释中的假密码 | GLiNER 区分注释和真实值 |
| 字典密码不识别 | GLiNER 理解 `'password': 'value'` |
| 敏感词列表太窄 | GLiNER 通过上下文判断 |
| 语义过滤形同虚设 | GLiNER 置信度直接分类 |
| NER 模型错配 | GLiNER 专门检测密钥 |

### 技术栈

- **场景识别**: `Xenova/mobilebert-uncased-mnli` (21 MB)
- **内容检测**: `nexuswho/gliner-onnx-small` (50 MB)
- **正则辅助**: 保留现有规则，作为兜底
- **总大小**: ~71 MB（远低于预算）

---

## 15. Case 6 修复 + 规则解耦

### 15.1 Case 6 问题分析

| # | 问题 | 根因 | 修复方式 |
|---|------|------|---------|
| 1 | `EMPTY_PASSWORD=` 等被错误识别 | ENV_PASSWORD 规则 `.+` 匹配任何非空值，无值质量校验 | 值长度、弱密码字典、纯数字过滤 |
| 2 | 重复值未合并 | `deduplicate()` 只按位置去重，不做值去重 | 增加按 original 值去重 |
| 3 | `SPECIAL_CHARS="p@ss!w0rd#$%^&*()"` 未识别 | 高熵字符集缺少 `"{}[]` 等 | 扩展字符集 |
| 4 | 高熵条件过严 | 要求同时有大小写+数字 | 改为至少 2 类字符 |
| 5 | 弱密码被识别 | 无弱密码过滤 | 增加弱密码字典 |

### 15.2 规则解耦方案

当前 `regexRules.ts`（467 行）混合 4 类职责，拆分为：

```
src/core/detector/rules/
├── constants.ts          # 共享常量（SENSITIVE_KEYWORDS, DB_SCHEMES 等）
├── valueFilters.ts       # 值质量过滤器（弱密码字典、长度、纯数字）
├── envPasswordRules.ts   # ENV_PASSWORD 规则（2 条）
├── dbPasswordRules.ts    # DB_PASSWORD 规则（2 条）
├── apiKeyRules.ts        # API_KEY 规则（7 条）
├── highEntropyRules.ts   # HIGH_ENTROPY 检测
├── privateKeyRules.ts    # PRIVATE_KEY 规则（1 条）
├── scanner.ts            # 扫描器（scanRegexRules）
└── index.ts              # 汇总导出
```

### 15.3 执行计划

- [x] 创建 `rules/constants.ts` — 共享常量 ✅ 已完成
- [x] 创建 `rules/valueFilters.ts` — 值质量过滤器 ✅ 已完成
- [x] 创建 `rules/envPasswordRules.ts` — ENV_PASSWORD 规则 ✅ 已完成
- [x] 创建 `rules/dbPasswordRules.ts` — DB_PASSWORD 规则 ✅ 已完成
- [x] 创建 `rules/apiKeyRules.ts` — API_KEY 规则 ✅ 已完成
- [x] 创建 `rules/highEntropyRules.ts` — HIGH_ENTROPY 检测 ✅ 已完成
- [x] 创建 `rules/privateKeyRules.ts` — PRIVATE_KEY 规则 ✅ 已完成
- [x] 创建 `rules/scanner.ts` — 扫描器 ✅ 已完成
- [x] 创建 `rules/index.ts` — 汇总导出 ✅ 已完成
- [x] 重写 `regexRules.ts` 为代理层 ✅ 已完成
- [x] `pipeline.ts` deduplicate 增加值去重 ✅ 已完成
- [x] `pipeline.ts` validateSensitiveEntity 增加弱密码校验 ✅ 已完成
- [x] 构建验证 ✅ 已完成

### 15.4 Case 6 修复后预期

| 输入 | 修复前 | 修复后 |
|------|--------|--------|
| `EMPTY_PASSWORD=` | 识别 | 不识别（空值） |
| `SPECIAL_CHARS="p@ss!w0rd#$%^&*()"` | 不识别 | 识别（高熵） |
| `LONG_SECRET=Aa1Bb2Cc3...` | 识别 | 识别（高熵） |
| `SHORT_PASS=ab` | 识别 | 不识别（太短） |
| `NUMERIC_SECRET=12345678901234567890` | 识别 | 不识别（纯数字） |
| `REPEATED_VALUE=abc123...` ×3 | 3 条 | 1 条（值去重） |
| `COMMON_PASSWORD=password123` | 识别 | 不识别（弱密码） |
| `WEAK_PASS=admin` | 识别 | 不识别（弱密码） |
| `DEFAULT_SECRET=secret` | 识别 | 不识别（弱密码） |
