# ② 本地脱敏代理服务（拦截出网请求 + 白名单 + 溯源审计）

> 状态：设计稿（**未实现**）。这是 1.0.0 之后的第二条线。
> 关联现状：`packages/engine/src/detector/{pipeline,profiles}.ts`、
> `packages/engine/src/detector/rules/`、`packages/engine/src/replacer/*`、
> `packages/engine/src/sites.ts`、`packages/engine/src/types/index.ts`
> （引擎零宿主依赖，因此可在 Node 下直接复用）

---

## 0. 定位与两种形态（先定分叉）

| | **A. 本地服务（推荐）** | **B. 托管后端** |
|---|---|---|
| 数据流向 | 原文不出设备，脱敏在本地进程内完成 | 原文先出网到后端，再在后端脱敏 |
| 与产品现有承诺 | 一致（本地处理、不上传，`manifest` 无 host_permissions 的零接触姿态） | **定位变更**，需重做信任叙事 |
| 工程成本 | 一个本地进程（API/代理层） | TLS + 多租户 + 留存策略 + DPA + 合规审计 |
| 适用 | 个人用户、CLI/IDE/agent、也可被扩展复用 | 企业集中审计（且建议只上传**元数据**） |

**结论**：以 A 为主体落地；B 只作为"审计汇聚"的可选项，且**只接收审计元数据，不接收原文**。

---

## 1. 目标与非目标

**目标**

1. 在**出网前**拦截 LLM 请求体，按策略做 `audit / sanitize / block`。
2. 提供白名单（值 / 域名 / 规则类型 / 仓库路径）。
3. 提供**溯源审计**：谁、什么时候、在哪个应用、命中了什么类型、做了什么动作——**不含原文**。

**非目标（本期不做）**

- 响应体清洗（流式 SSE 不动）。
- 系统级 TLS MITM（本期只做 base_url 覆盖；MITM 列入后续可选）。
- 跨应用 UI 注入（Accessibility）——见 ①/评估结论，优先级最低。

---

## 2. 拦截点选择（按侵入度排序）

| 方案 | 是否本期 | 说明 |
|---|---|---|
| **① base_url / env 覆盖**（推荐） | ✅ | 用户把 `OPENAI_BASE_URL`、`ANTHROPIC_BASE_URL` 等指向 `http://127.0.0.1:PORT/v1`，代理改写请求体后转发到真实上游。**不装 CA、不 MITM**，覆盖绝大多数 SDK/CLI/agent |
| ② `HTTPS_PROXY` + CONNECT + MITM | ❌（后续） | 仅当客户端不支持 base_url 覆盖时兜底；需自签 CA、跳过证书固定、EDR 常拦。必须显式授权 + 仅拦 LLM 域名白名单 |
| ③ 应用内 hook（VS Code 扩展 / TUI wrapper） | ❌（后续） | 可靠但每应用一份适配 |
| ④ 全局剪贴板热键 | ❌（另一条线） | 覆盖"非 API 的桌面聊天应用"，与代理互补，不冲突 |

**本期的边界条件**：只处理 `POST` + `Content-Type: application/json` 的 LLM 端点；其余流量直通（不做通用中间人）。

---

## 3. 目标架构

```
AI 应用 / CLI / IDE
   │  OPENAI_BASE_URL=http://127.0.0.1:8787/v1   （或 HTTPS_PROXY，后续）
   ▼
┌──────────────────────────────────────────────┐
│ pasteguard-proxy（本地 Node 进程，127.0.0.1） │
│  1) 路由：识别上游（openai/anthropic/自定义） │
│  2) 抽取：从 JSON 里取出所有 prompt 字符串     │
│  3) 检测：detect(text, profile)  ← core 复用  │
│  4) 策略：audit / sanitize / block            │
│  5) 改写：sanitizeText() 回写 JSON（保结构合法）│
│  6) 审计：写元数据（无原文）                   │
└───────────────┬──────────────────────────────┘
                │ 改写后的请求体
                ▼
        真实上游 API（https://api.openai.com/…）
```

> 关键收益：在 Node 世界里，①③ 那份"模型宿主"难题**不存在**——长驻进程、无 CSP、无 SW 生命周期，可直接用 `onnxruntime-node`（真多线程）或沿用 wasm 后端。也就是说 **AI 增强在代理侧比在扩展侧更容易**。

---

## 4. 请求处理管线

```
onRequest(req)
 ├─ 直通判定：非 POST / 非 json / host 不在允许列表 / path 不在允许列表 → 原样转发
 ├─ body 读取（上限，如 8MB；超出 → 直通 + 审计记 too_large）
 ├─ JSON 解析失败 → 直通 + 审计记 parse_error（绝不让代理成为故障点）
 ├─ 抽取候选字符串（按上游 schema 白名单，不做"扫全字段"以免误伤）
 │    openai:    messages[].content(.text) / input / instructions / prompt / tools[].function.arguments
 │    anthropic: system / messages[].content[].text / tools[].input
 │    通用:      system / prompt / input / messages
 ├─ 每个候选串 → detect(text, profile, { enableContentDetection })
 ├─ 合并 items → 策略裁决（§5）
 ├─ sanitize → 用 sanitizeText(text, items) 回写同字段
 ├─ 审计事件落库（§6）
 └─ 转发（保持 headers / stream 语义；只改 body）
```

工程红线：

1. **只改请求体，不动响应**（SSE 流式体验零影响）。
2. **改坏就直通**：任何异常（解析/抽取/改写后 JSON 不合法）→ 回退为原 body 转发 + 审计标记 `degraded`，避免把用户工作流打 400。
3. **改写后必须 `JSON.stringify` 再校验一遍**（`JSON.parse(JSON.stringify(x))` 等价性不必强制，但必须能被 `JSON.parse` 解开）。
4. 多模态/二进制字段（`image_url`、`file`）**跳过**，只处理纯文本字段。

---

## 5. 策略与白名单

### 5.1 三种动作（按 规则类型 × 上游 × 路径 分档）

| 动作 | 行为 | 适用 |
|---|---|---|
| `audit` | 放行原文，只记录审计事件 | 观察期、可信仓库、调试 |
| `sanitize` | 就地替换为占位符后转发 | **默认** |
| `block` | 不转发，返回明确错误（如 403 + 说明） | 高敏感（私钥/生产库口令） |

### 5.2 白名单（直接复用现有实现）

| 维度 | 实现 | 出处 |
|---|---|---|
| 值白名单（精确匹配不脱敏） | `profile.whitelist` + `applyWhitelist()` | `pipeline.ts:275,491` |
| 规则类别/灵敏度 | `profile.enabledCategories` / `sensitivity` | `types/index.ts:55-57` |
| 站点/域名 | `matchSite()` + 模式规范化 | `sites.ts:12,37` |
| 自定义规则 | `profile.customRules`（含 ReDoS 校验） | `types/index.ts:34-45` |
| 仓库路径白名单（新增，代理侧） | `--allow-repo <glob>`：命中的请求只 `audit` 不 `sanitize` | 新增（代理层） |
| 客户端白名单（新增） | 按 `User-Agent` / 自定义 header 识别应用 → 独立策略 | 新增（代理层） |

### 5.3 误报逃生通道（必须有）

代码场景下熵规则会频繁命中（长 base64/哈希）。必须提供：

- `pasteguard proxy pause --for 15m`（临时全局放行）
- 单次放行：审计事件里给出 `eventId`，`pasteguard proxy allow <eventId>` 把该值加入会话级白名单
- 面板/日志必须能一眼看到"最近被脱敏的值类型分布"，便于快速判断是不是误伤

---

## 6. 审计数据模型（含红线）

### 6.1 红线：占位符 ↔ 原文的映射就是最高敏感数据

`MappingManager`（`src/core/replacer/mapping.ts:9-12`）里 `placeholder → original` 一旦落盘或上传，等于把脱敏**倒推**回原文。因此：

- **默认**：只落元数据；映射仅存在于单次请求的内存生命周期内。
- **只有用户显式开启"可回溯"**时，才在**本地加密**存储映射（AES-GCM，密钥来自 OS keychain 或用户口令），带 TTL 与"一键清除"。
- **任何情况下都不把映射或原文写入审计事件、不发给后端。**

### 6.2 事件结构

```ts
interface AuditEvent {
  id: string                 // ulid
  ts: number
  app: string                // 'codex-cli' | 'vscode' | UA 推断
  upstream: string           // 'api.openai.com'
  path: string               // '/v1/chat/completions'
  profileId: string
  decision: 'allow' | 'sanitized' | 'blocked' | 'degraded'
  findings: Array<{
    type: DetectionType      // ENV_PASSWORD / API_KEY / EMAIL / ...
    source: 'regex' | 'model'
    confidence: Confidence
    action: 'replace' | 'keep'
    length: number           // 原值长度（不含内容）
    fingerprint?: string     // 加盐哈希前 8 位（同一密钥跨请求可关联，但不可反推）
  }>
  counts: { total: number; replaced: number; kept: number }
  bytesIn: number
  latencyMs: number
}
```

### 6.3 存储与保留

- 默认 SQLite 单文件（`~/.pasteguard/audit.db`）；`--audit-out file:jsonl` 备选便于企业采集。
- 保留期：默认 30 天，`--retention 7d|30d|forever`；启动时清理过期。
- 企业汇聚：只上传 `AuditEvent`（可聚合），**绝不上传原文/映射**。

---

## 7. CLI 与集成

```
pasteguard proxy start [--port 8787] [--profile universal]
                       [--upstream openai=https://api.openai.com]
                       [--mode sanitize|audit|block] [--fail-closed]
                       [--allow-repo <glob>] [--retention 30d]
pasteguard proxy status | stop | pause --for 15m
pasteguard proxy audit [--since 24h] [--type API_KEY] [--json]
pasteguard proxy allow <eventId>            # 会话级白名单
pasteguard run -- <cmd>                     # 注入环境变量后运行子进程
```

`pasteguard run` 的行为（一次性上手的关键）：

```bash
OPENAI_BASE_URL=http://127.0.0.1:8787/openai/v1
ANTHROPIC_BASE_URL=http://127.0.0.1:8787/anthropic
HTTP_PROXY=http://127.0.0.1:8787        # 可选，后续 MITM 模式
pasteguard run -- codex
```

代理内部用**路径前缀**路由上游：`/openai/*` → openai、`/anthropic/*` → anthropic，其余 404（避免变成通用代理）。

### 失败语义

- 默认 `fail-open`（检测异常 → 直通 + 审计 `degraded`），保证不打断工作流。
- `--fail-closed` 可选：检测异常 → 阻断（高敏场景）。

---

## 8. Node 侧复用与模型宿主

| 复用项 | 状态 | 说明 |
|---|---|---|
| `core/detector`（正则管线） | ✅ 直接可用 | `tests/helpers.ts:7-13` 已在 Node（vitest）跑 `detect()` |
| `core/replacer`（`sanitizeText`） | ✅ 直接可用 | 纯函数，无 chrome 依赖（`replacer/index.ts:96`） |
| `core/detector/profiles`、`regexRules`、`customRules` | ✅ | 纯 TS |
| `modelDownload` | ⚠️ 需替换实现 | 依赖 `caches`（`modelDownload.ts:261,331`）与 `chrome.storage` 锁（`:872`）；Node 侧要么注入 `fetch/cache` 适配（模块本身已支持注入），要么改为本地文件缓存 |
| GLiNER 推理 | ⚠️ 需后端切换 | 扩展里是 `onnxruntime-web` + 自定义 vite alias shim（`vite.config.ts:31-34`）；Node 侧建议走 `onnxruntime-node`（真线程，快得多），需抽象一个 `InferenceBackend` |

**抽象建议**：把"检测能力"抽成 `DetectionService` 接口，两处实现：

- `ExtensionDetectionService`（现状：本地/offscreen 宿主，见 ①）
- `NodeDetectionService`（代理侧：文件缓存 + onnxruntime-node）

这样 ① 和 ② 共享 `core/**` 而互不依赖宿主细节。

**AI 在代理侧的成本**：模型 183MB 首跑下载（可复用同一套多源回退/断点续传逻辑，改注入 `fetch` + 文件缓存）；常驻内存一份；正则档 < 10ms，AI 档按段计（同扩展的级联上限）。

---

## 9. 测试与验证

**单测（vitest，node）**

- 抽取器：各上游 schema 的候选字段抽取（含 `content` 为数组/字符串两种形态、`tools[].function.arguments` 是字符串化 JSON 的坑）。
- 改写器：改写后 JSON 可解析；未命中字段保持字节级不变；多模态字段不动。
- 策略裁决：`audit/sanitize/block` × 类型 × 白名单真值表。
- **审计红线测试**：构造含明显密钥的请求 → 断言审计记录里**不出现**该密钥的任何子串（含 base64/哈希前的原值）。
- 降级：畸形 JSON / 超长 body / 上游 5xx → 直通 + `degraded`。

**集成测试（起真实 server + stub 上游）**

- 起代理在 0 端口 → 起一个 stub 上游 → 发带密钥的 `chat/completions` → 断言：stub 收到的 body 已被脱敏、且不含原值；流式响应原样透传（SSE chunk 时间戳/顺序不变）。
- `--fail-closed` 下检测异常 → 返回阻断错误。

**验证命令**

```
npm run typecheck && npx vitest run          # 扩展侧基线不回归（311 项）
npm run build && npm run probe:layout        # 扩展侧不受影响（本设计不改扩展）
```

---

## 10. 分阶段实施与检查点

| 阶段 | 内容 | 检查点 |
|---|---|---|
| **P1 骨架** | `service/` 子包（或 `src/service/`）+ 本地 HTTP server + 路径前缀路由 + 直通/dev 模式 | 不改写时能用代理跑通一次真实对话（字节级透传） |
| **P2 正则脱敏** | 抽取 + `detect()`（正则档）+ `sanitizeText` 回写 + `audit/sanitize/block` | 集成测试全绿；手工：codex/CLI 请求中的密钥被替换 |
| **P3 白名单 + 审计** | `profile.whitelist`/规则/域名/仓库路径 + SQLite 事件 + `audit` 子命令 + 红线测试 | 审计库中无原文（自动化断言）；误报逃生通道可用 |
| **P4 上手体验** | `pasteguard run` 环境注入 + `status/pause/allow` + 文档 | 用户按文档 3 步内跑通 |
| **P5 AI 档（可选）** | `NodeDetectionService`（onnxruntime-node）+ 模型本地缓存 | 记录正则 vs AI 的延迟/内存；AI 可独立开关 |
| **P6 MITM（可选，需评估）** | CA 生成/信任引导 + 仅 LLM 域名白名单 | 明确风险提示；仅作为 base_url 不可用时的兜底 |

---

## 11. 风险与待验证项

| 风险 | 等级 | 处置 |
|---|---|---|
| 客户端不读 `OPENAI_BASE_URL` 等环境变量 | 中 | 提供 `pasteguard run` 包装 + 逐应用集成文档；兜底才是 MITM（P6） |
| 代码场景误报（熵规则命中哈希/base64） | **高** | 默认 `audit` 观察期 + 逃生通道 + 针对代码场景调 profile；这是本方案最可能的获客阻碍 |
| 改写破坏 JSON 结构 → 上游 400 | 中 | 改写后 `JSON.parse` 校验；失败即直通 + `degraded` |
| 审计库变成新的敏感库 | **高** | 红线（§6.1）：默认只存元数据；指纹加盐；映射默认不落盘；TTL + 一键清除 |
| Node 侧模型后端切换工作量被低估 | 中 | P5 独立成阶段，先交付正则档（可用性已足够） |
| 代理成为单点故障 | 中 | `fail-open` 默认；`pasteguard proxy stop` 后环境变量回退需文档说明 |
| 合规：读取"发送出去的代码包" | 高 | 明确同意范围（仅指定域名/字段）、默认不落原文、企业版支持"审计留痕但内容不留" |
| 托管后端（形态 B）与现有隐私叙事冲突 | 高 | 不作为默认；若做，只接元数据，且在 UI/文档显式声明信任边界 |
