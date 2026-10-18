# PasteGuard 产品（技术）说明文档

> 面向开发者与技术评审。快速开始见 `README.md`，手动验收见 `docs/test-cases.md`，
> 待办状态见 `TODO.md`。本文档所有描述以 `src/` 代码为准（版本 1.0.0）。

## 1. 产品定位与功能矩阵

**定位**：AI 对话前的本地数据脱敏浏览器扩展（Chrome / Firefox，Manifest V3）。
用户在任意站点把文本发给 AI 前，自动检测并替换敏感信息；所有处理在浏览器本地完成，
文本不出机器（唯一网络行为是可选的模型下载）。

| 功能 | 状态 | 说明 |
|------|------|------|
| 侧栏手动脱敏 | ✅ | 粘贴 → 检出列表 → 单条/一键脱敏 → 复制 |
| 正则基础引擎 | ✅ 恒开 | 14 类检测（密钥 5 + PII 7 + 高熵 + 自定义），SW 亦可用 |
| AI 增强（GLiNER） | ✅ 可选 | 级联触发，仅处理正则未覆盖片段；首次需下载 ~183MB 模型 |
| 检测档案 | ✅ | 内置 3 档 + 用户自定义（类别/灵敏度/分类型策略/白名单/GLiNER 标签） |
| 自定义正则规则 | ✅ | ReDoS 双层防护；档案 JSON 剪贴板导入导出 |
| 粘贴自动拦截 | ✅ 可选 | 逐站授权，在已授权站点粘贴时自动就地替换（正则档） |
| 明暗主题 | ✅ | 跟随系统 `prefers-color-scheme` |
| 双目标构建 | ✅ | Chrome `dist/` / Firefox `dist-firefox/` |

## 2. 总体架构

三个运行环境，职责单一：

```
┌─────────────────────────── chrome side panel（Vue 3 + Pinia + reka-ui） ──┐
│ 输入区（档案下拉/检测/清空） → 检出列表（置信度徽章/单条操作） → 复制     │
│ 引擎状态面板（正则恒开卡 + AI 卡 + 粘贴拦截站点管理）                     │
│ 模型加载与状态机全部在 store（stores/detection.ts）                       │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ 直接 import（同页面）
┌──────────────▼──────── Service Worker（background/service-worker.ts）────┐
│ 1) 扩展图标 → sidePanel.open（Chrome）→ 回退 sidebarAction.open（FF）   │
│ 2) 粘贴检测服务：接收 PASTE_DETECT 消息，跑正则档 detect()，回传脱敏文本 │
│ 3) 受保护站点按需注入：tabs.onUpdated + storage.onChanged 触发           │
└──────────────▲───────────────────────────────────────────────────────────┘
               │ chrome.runtime.sendMessage（PASTE_DETECT 契约）
┌──────────────┴── content script（background/pasteEntryPoint.ts 注入函数）─┐
│ 监听已授权站点输入框的 paste → 文本送 SW → 就地改写（先插后换，不阻塞）   │
└───────────────────────────────────────────────────────────────────────────┘
```

关键约束：

- **模型不在 SW 加载**：`isContentModelReady()` 按上下文判定，SW 内恒为未就绪 →
  粘贴拦截天然走正则档，侧栏不必开着；
- **无 manifest content_scripts**：粘贴监听仅按授权站点动态注入，未授权站点零接触；
- 消息契约单一：`PASTE_DETECT { text } → PasteDetectResponse { ok, sanitized, count }`
  （`src/core/messages.ts`）。

## 3. 检测管线（core/detector/pipeline.ts）

单入口 `detect(text, profile, config)`，配置仅一个开关 `enableContentDetection`（AI 级联；
正则为基础引擎恒开，无关闭入口）。处理链：

```
1. 正则规则     按 profile.enabledCategories（secret/pii/entropy）取规则集扫描
                熵阈值随类别灵敏度档（loose/standard/strict）变化
2. 自定义正则   profile.customRules 中 enabled 的规则（ReDoS 防护后）并入
3. AI 级联      （enableContentDetection && 模型就绪时）
   3a. 场景启发式 detectScene（yaml/env/code/log/json/plain，零延迟离线，
       结果仅作 GLiNER 提示词，不影响正则检出；AI 关闭时整步省去）
   3b. buildUncoveredSegments：只取正则未覆盖片段（≤20 段、总计 ≤8000 字符、
       去空白后 ≥8 字符），偏移映射回全文
   3c. GLiNER 实体分类 → 形状门禁 isPlausibleEntity（检出必须形似标签：单字姓名、
       无@邮箱、短地址等幻觉直接丢弃并记 Dropped 日志）→ 阈值分档：
       >0.65 sensitive / <0.35 not / 其间 uncertain
   3d. sensitive 经 validateSensitiveEntity 正则验证后采纳（已覆盖区跳过）
   3e. uncertain 回流正则复检；复检不中的以 ≤0.5 低置信保留（默认档案
       tierLowConfidence=true 下仅提示不替换）
4. 后处理链   位置去重 → 按起点排序 → 重叠归并仲裁 → 值传播 → 白名单过滤
               → 按值聚合 → 占位符按值共享
```

后处理链要点：

- **重叠仲裁**：类型优先级 凭据(3) > PII(2) > 高熵(1)；同级比较 置信度 → span 长度 →
  出现顺序；完全包含保留容器。保证任意两条检出区间不相交，替换互不切坏；
- **值传播**：凭据类（优先级 3）且值 ≥8 字符时，全文所有裸露出现一并标记
  （修复「重复值只识别第一个」）；
- **占位符规则**：格式 `<<TYPE:N>>`；**同值必同占位符**（跨类型共享映射），
  替换后同一敏感值在全文恢复为同一原文。

模型侧实体类型经 `entityTypeMap` 归一到 14 个 `DetectionType`：

`ENV_PASSWORD / API_KEY / DB_PASSWORD / JWT / PRIVATE_KEY / HIGH_ENTROPY / EMAIL / PHONE /
ID_CARD / BANK_CARD / IP_ADDRESS / PLATE / NAME / ADDRESS`

## 4. 规则体系（core/detector/rules/，已解耦）

| 文件 | 职责 |
|------|------|
| `constants.ts` | 共享常量（敏感关键词、DB scheme 表等） |
| `valueFilters.ts` | 值质量过滤：弱密码字典（password/admin/secret…）、最小长度、纯数字剔除 |
| `envPasswordRules.ts` / `kvRules.ts` | `KEY=VALUE` / YAML / JSON 键值对密码 |
| `dbPasswordRules.ts` | 连接串（含独立 scheme 表，多 `@` 不截断） |
| `apiKeyRules.ts` | sk-/AKIA/ghp_/xox- 前缀 + 通用长随机串 |
| `highEntropyRules.ts` | 高熵检测（字符类 ≥2，阈值随灵敏度档） |
| `privateKeyRules.ts` / `emailRules.ts` / `piiRules.ts` | 私钥 / 邮箱 / PII（手机号、身份证、银行卡 Luhn、IP、车牌） |
| `customRules.ts` | 用户自定义规则（见 §5 ReDoS） |
| `scanner.ts` | 统一扫描器（extractor 按捕获组精确定位原文区间） |

空值、过短（<4）、纯数字、弱密码字典值一律不检出（防误报基线，金样例回归覆盖）。

## 5. 档案系统（core/detector/profiles.ts + userProfiles.ts）

- **内置 3 档**（不可删改）：`universal` 不限（全类别，中低置信仅提示）、
  `text` 通用文本（PII 为主、高熵 strict）、`code` 代码开发（密钥全开、高熵 loose）；
  三档默认 `EMAIL/HIGH_ENTROPY/IP_ADDRESS = keep`（检出但不替换）；
- **自定义档案**：类别开关、每类别灵敏度、分类型默认策略（replace/keep，UI 为 Switch）、
  `tierLowConfidence`、GLiNER 标签集（预设 个人信息集/密钥集/全部/自定义）、
  值白名单（精确匹配，含传播产生的出现一并豁免）、自定义正则；
- CRUD 持久化 `chrome.storage.local`（键 `pasteguard.userProfiles`），激活档案
  `pasteguard.activeProfile`；内置档案用 `builtin: true` 判定，UI 行为差异
  （无齿轮/不可删除）全部由该标志驱动；
- **导入导出**：整库 JSON 走剪贴板（避免文件权限）；导入经 schema 校验，坏数据拒绝。

**自定义正则 ReDoS 双层防护**（`rules/customRules.ts`）：

1. 静态：星号高度解析，拒绝嵌套量词（`(a+)+`、`(x*)*` 等灾难性回溯主因）；模式 ≤200 字符；
2. 运行时：每条规则 50ms 时间预算 + 匹配上限 200，超限中断该规则并告警。

## 6. 替换引擎（core/replacer/）

- `MappingManager`：占位符 ↔ 原文映射表（同值共享，见 §3）；
- `sanitizeText(text, items)`：纯函数（局部映射实例），SW 与侧栏共用；
- UI 侧单条 keep/replace 切换改写映射表，复制输出即时反映。

## 7. AI 增强：模型与下载机制

**模型**：`onnx-community/gliner_small-v2` 的 `onnx/model_quantized.onnx`（int8 量化，
183,403,734 字节 ≈183MB）；运行栈 `gliner` + `onnxruntime-web`（WASM，单线程，
CSP 需 `wasm-unsafe-eval`）+ `@xenova/transformers`（tokenizer）。场景识别为启发式
（`sceneDetector.ts`），不占模型。

**下载器**（`modelDownload.ts`，全部依赖可注入以便 node 环境单测）：

| 机制 | 说明 |
|------|------|
| 多源轮换 | ModelScope 主源（302 + ACAO:*，国内 ~14MB/s）→ HuggingFace 兜底，共 5 次。**hf-mirror 已禁用**（308 无 ACAO，CORS 逐跳校验必失败） |
| 断点续传 | 会话内 + 跨会话（Cache Storage `?partial`，元数据在条目响应头 `x-model-bytes/total/etag/saved-at`，读取三重一致性校验）；仅同源+强 etag 发 `If-Range` |
| 重试退避 | 指数退避、尊重 `Retry-After`、封顶 16s |
| 停滞看门狗 | 30s 无字节中断（下次从断点续）；进度心跳续期，杜绝无 Content-Length 的假超时 |
| 完整性校验 | 字节数不符不入缓存，绝不拼脏数据 |
| 多窗口去重 | storage 单键锁 `pasteguard.modelLock`（owner + 30s 心跳 TTL + 进度转发）；抢锁方等待显示「另一窗口下载中」，等待 ≤~5 分钟超时后自行下载；接管前再查缓存 |
| 缓存失效 | 缓存 key 固定（不带版本号）；命中后 1 字节探测（`Range: bytes=0-0`，5s 超时）比对 ETag → 长度兜底；离线优先沿用缓存；旧 `?v=` key 一次性搬迁 |
| 单飞门闩 | `createSingleFlight`：并发加载复用同一 promise，重试不产生并行下载 |
| 内存释放 | `initialize()` 后置空对 183MB ArrayBuffer 的引用（ORT session 已持 wasm 堆副本）；前后打 JS 堆快照日志 |

**UI 语义**：只有确认走网络下载（`onDownloadStart`）才显示 toast 与进度条；
**缓存命中全程静默**（仅 console 日志），杜绝「先闪首次需下载再变已命中」的误导。

## 8. 粘贴自动拦截

- **授权模型**：`optional_host_permissions`（https/http 通配）+ 运行时
  `chrome.permissions.request`（必须用户手势）——**不申请 `<all_urls>`**，
  未授权站点零接触；
- **注入时机**：`tabs.onUpdated`（loading 且 URL 匹配）+ 站点列表变化时对已开页面即时注入；
  `chrome.scripting.executeScript({ allFrames: true })`，无 manifest 常驻脚本；
- **就地替换策略**：先插入后就地替换（不阻塞输入）；站点规范化与匹配在
  `core/sites.ts`（单测 11 例）；插入区间推导与改写守卫为纯函数
  （`content/pasteText.ts`，单测 6 例）；
- **四重守卫**：`password`/隐藏输入框绝不处理；插入文本与剪贴板逐字吻合才改写；
  检测期间用户继续输入（文本发散）即放弃改写；单次超 20,000 字符直接放行；
- **已知限制**：仅 `input[type=text/search]` 与 `textarea`（contenteditable 待后续）；
  拦截为正则档（模型不进 SW）。

## 9. 权限与安全模型

**权限逐项理由**（`manifest.json`）：

| 权限 | 用途 |
|------|------|
| `sidePanel` | 侧栏主界面 |
| `storage` | 档案/AI 开关/受保护站点/模型锁持久化 |
| `clipboardWrite` | 脱敏结果与档案 JSON 复制 |
| `unlimitedStorage` | 183MB 模型缓存配额 |
| `scripting` | 仅向已授权站点注入粘贴监听 |
| `optional_host_permissions` | 粘贴拦截逐站授权（运行时按需申请） |
| `contextMenus` | ⚠️ 声明但当前未使用（历史遗留，清理候选见 TODO） |

**CSP**（extension_pages）：`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
connect-src 'self' https:`——无 `http:`/`ws:`；`wasm-unsafe-eval` 为 ORT WASM 必需
（Firefox MV3 同样要求显式声明）。

**隐私承诺的代码依据**：全项目仅模型下载一处 `fetch`（`modelDownload.ts`）；
AI 关闭即零网络；检测/替换全部本地；无遥测、无统计。

**其他**：自定义正则 ReDoS 双层防护（§5）；粘贴拦截四重守卫（§8）；
CSP 收紧后扩展页无任何外部脚本/连接可能。

## 10. 存储清单（chrome.storage.local）

| 键 | 内容 |
|----|------|
| `pasteguard.activeProfile` | 激活档案 id |
| `pasteguard.aiEnabled` | AI 增强开关 |
| `pasteguard.aiOnboardingSeen` | 首启引导已看标记 |
| `pasteguard.userProfiles` | 用户自定义档案全量（CRUD 持久化） |
| `pasteguard.protectedSites` | 粘贴拦截授权站点列表 |
| `pasteguard.modelLock` | 多窗口下载锁（owner + 心跳 TTL + 进度） |
| `pasteguard.lastModelProbe` | 缓存探测节流戳（24h） |
| Cache Storage `?partial` 条目 | 模型断点续传分片（元数据在响应头） |
| Cache Storage `pasteguard.invalid/models/...` | 模型成品缓存（合成 origin，规避扩展页 HTTP 缓存差异） |

## 11. 构建与双目标

- 技术栈：Vite + CRXJS（单一输入 manifest，靠 `side_panel`/`service_worker` 发现打包入口；
  分叉输入会漏打包）+ vue-tsc 类型检查 + vitest；
- `npm run build` → Chrome `dist/`；
- `npm run build:firefox` → `vite build --mode firefox` 仅切 outDir，键转换集中在
  `scripts/postbuild.mjs`：`service_worker → scripts`、`side_panel → sidebar_action`、
  移除 `sidePanel` 权限、补 `browser_specific_settings.gecko`
  （`pasteguard@pasteguard.dev`，min 121）；
- SW 运行时探测 `chrome.sidePanel.open` → 回退 `chrome.sidebarAction.open`，
  同一份 SW 代码服务双浏览器。

## 12. 测试体系

`npm test`：**163 断言 / 17 文件**（`npm run typecheck` 0 错误为另一道闸）：

- `tests/golden/`（4）：内置三档 + 白名单端到端金样例；
- `tests/unit/`（10）：规则与值过滤、自定义规则 ReDoS、管线配置、store 状态机、
  模型下载（续传/退避/看门狗/完整性/缓存/锁/单飞）、粘贴改写纯函数、站点匹配、
  档案 CRUD 与 IO、替换引擎、基础功能；
- `tests/perf/`（1）：长文本性能护栏；
- `tests/regression/`（2）：历史缺陷回归、CJK 边界。

原则：下载器/管线等纯逻辑全部依赖注入，node 环境可单测；真机判定项（视觉/真实下载/
权限弹窗/真实推理）收敛到 `docs/test-cases.md`，不与自动化重叠。

## 13. 已知限制

1. 粘贴拦截不支持 `contenteditable` 富文本区域；
2. 拦截为正则档——GLiNER 推理仅侧栏手动流程可用；
3. AI 模型 ~183MB 首次下载依赖网络（支持断点续传与多窗口去重）；
4. GLiNER 对自由文本（无格式姓名/地址）的召回依赖模型能力，中低置信默认仅提示；
   2026-10-18 实机：中文真召回为零，0.25–0.65 区间多为单字幻觉（「户」→姓名 0.456、
   「订」→邮箱 0.330），已由形状门禁（`entityShape.ts` 的 `isPlausibleEntity`）拦截；
   形似词幻觉（如 2 字词→姓名）仍可能通过，属模型能力限制，换更强模型才能收敛；
5. `contextMenus` 权限声明未使用（清理候选）；
6. tokenizer/config 由 gliner 内部 transformers 下载，走其自带缓存，不受 §10 版本管理。

## 14. 待回填实测数据

- [ ] JS 堆峰值（模型下载完成 / 初始化释放引用两个时点的快照值）——
      实机打开侧栏、观察控制台 `[PasteGuard] 内存快照` 日志后回填此处；
      验收用例见 `docs/test-cases.md` TC-06-4。
