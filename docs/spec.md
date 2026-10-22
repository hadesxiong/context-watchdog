# ContextWatchdog 产品（技术）说明文档

> 面向开发者与技术评审。快速开始见 `README.md`，手动验收见 `docs/test-cases.md`，
> 待办状态见 `TODO.md`，实现轮次与结案沿革见 `CHANGELOG.md`。本文档所有描述以代码为准
> （`packages/`、`apps/`、`scripts/`；版本 1.0.0）。

## 1. 产品定位与功能矩阵

**定位**：AI 对话前的本地数据脱敏浏览器扩展（Chrome / Firefox，Manifest V3）。
用户在任意站点把文本发给 AI 前，自动检测并替换敏感信息；所有处理在浏览器本地完成，
文本不出机器（唯一网络行为是可选的模型下载）。

| 功能 | 状态 | 说明 |
|------|------|------|
| 侧栏手动脱敏 | ✅ | 粘贴/输入 → 点「检测」→ 检出列表 → 单条/一键脱敏 → 复制 |
| 正则基础引擎 | ✅ 恒开 | 14 类检测（密钥 5 + PII 7 + 高熵 + 自定义），SW 亦可用 |
| AI 增强（GLiNER） | ✅ 可选 | 级联触发，仅处理正则未覆盖片段；首次需下载 ~183MB 模型（ort wasm ~11MB 随包本地加载，推理本身离线可用） |
| 检测档案 | ✅ | 内置 5 档（universal / text / code / us / eu）+ 用户自定义（类别/灵敏度/分类型策略/白名单/GLiNER 标签） |
| 自定义正则规则 | ✅ | ReDoS 双层防护；档案 JSON 剪贴板导入导出 |
| 粘贴自动拦截 | ✅ 可选 | 逐站授权，粘贴时自动就地替换（正则档；input/textarea 与 contenteditable 均支持，命中显示「已脱敏 N 处」提示） |
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
1. 正则规则     按 profile.enabledCategories 取规则集扫描
                （secret / pii / entropy / us / eu；区域类别默认全关，
                  由 us / eu 档案显式开启，避免给其他地区抬高误报）
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
| `apiKeyRules.ts` | sk-/AKIA/ghp_/xox- 等前缀规则 + 通用长随机串 + 短密钥族（前缀即证据，10 家官方格式） |
| `highEntropyRules.ts` | 高熵检测（字符类 ≥2，阈值随灵敏度档） |
| `privateKeyRules.ts` / `emailRules.ts` / `piiRules.ts` | 私钥 / 邮箱 / PII（手机号、身份证、银行卡 Luhn、IP、车牌） |
| `customRules.ts` | 用户自定义规则（见 §5 ReDoS） |
| `scanner.ts` | 统一扫描器（extractor 按捕获组精确定位原文区间） |

空值、过短（<4）、纯数字、弱密码字典值一律不检出（防误报基线，金样例回归覆盖）。
短密钥阈值策略（2026-10-18 拍板落地）：无前缀的 8–32 位随机串维持不检测（会话号/
设备号撞形误报不可控，高熵阈值不动）；独特厂商前缀的官方短格式（Anthropic、HuggingFace、
npm、GitLab、SendGrid、Postman、Shopify、DigitalOcean、Mailgun、Twilio）按规格精确收录；
「短但有上下文」由 env/kv 键值规则行锚定兜底。

**区域规则集（`us` / `eu`，`usRules.ts` / `euRules.ts`）**：区域规则**默认全关**，
只有选了对应档案（或在自定义档案里勾上该类别）才参与扫描。这不是保守，而是误报控制：
`\d{3}-\d{2}-\d{4}` 这种形状在任何地区的文本里都可能出现，把它塞进通用集会让所有
非美区用户承担误报代价。每条规则都带校验，裸正则在真实文本里不可用：

| 规则 | 校验方式 |
|------|---------|
| SSN（社保号） | 号段校验：排除区号 000/666/9xx、组号 00、序号 0000、三段全同数字 |
| EIN（税号） | **要求带标签**（EIN/FEIN/TIN/Tax ID）——裸 `\d{2}-\d{7}` 与日期区间无法区分；再校验 IRS 已分配前缀 |
| 北美电话 | NANP：区号与局号首位必须为 2-9（这一条即挡掉 `2024-01-0100` 这类日期） |
| IBAN | ISO 13616 mod-97（15~34 位任意串通过率约 1/97），紧凑与分组写法都收 |
| 增值税号 | 逐国格式表（希腊用 `EL` 而非 `GR`，这是 VIES 的定义） |

增值税号目前**只有格式校验**（无通用校验位），因此置信度为 `medium`；DE/FR 等
逐国校验位属后续迭代。

## 5. 档案系统（core/detector/profiles.ts + userProfiles.ts）

- **内置 5 档**（不可删改）：`universal` 不限（全类别，中低置信仅提示）、
  `text` 通用文本（PII 为主、高熵 strict）、`code` 代码开发（密钥全开、高熵 loose、
  PII 类默认仅提示）、`us` 美国个人信息 与 `eu` 欧盟个人信息（通用之上追加对应
  区域类别，`tierLowConfidence: false`——用户显式选区域档，即希望检出的都替换）；
  五档默认 `EMAIL/HIGH_ENTROPY/IP_ADDRESS = keep`（检出但不替换）；
- **自定义档案**：类别开关、每类别灵敏度、分类型默认策略（replace/keep，UI 为 Switch）、
  `tierLowConfidence`、GLiNER 标签集（预设 个人信息集/密钥集/全部/自定义）、
  值白名单（精确匹配，含传播产生的出现一并豁免）、自定义正则；
- CRUD 持久化 `chrome.storage.local`（键 `contextwatchdog.userProfiles`），激活档案
  `contextwatchdog.activeProfile`；内置档案用 `builtin: true` 判定，UI 行为差异
  （无齿轮/不可删除）全部由该标志驱动；
- **导入导出**：整库 JSON 走剪贴板（避免文件权限）；导入时重新生成 id、重名档案
  加数字序号、危险正则被 sanitize 过滤，schema 校验不过的坏数据整条拒绝。

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

**wasm 资产本地化**（2026-10-18）：gliner 默认把 `env.wasm.wasmPaths` 指向 jsdelivr
CDN（`index.mjs:615`），改传空对象绕过其默认值 → ORT 门面视同「不覆盖」，`locateFile`
不设置，emscripten 回落到构建时改写好的打包内资产（胶水加载器 `zp` 忽略参数恒用打包内
模块，ort 1.19.2 实证）→ wasm ~11MB 随扩展分发，**离线推理可用、零 CDN 依赖**；同时
vite 别名把 gliner 静态引用的 `onnxruntime-web/webgpu|webgl` 打桩（EP 固定 `'wasm'`），
剔除 21.3MB `jsep.wasm` 死重——产物总量 ~34MB → ~12MB。

**下载器**（`modelDownload.ts`，全部依赖可注入以便 node 环境单测）：

| 机制 | 说明 |
|------|------|
| 多源轮换 | ModelScope 主源（302 + ACAO:*，国内 ~14MB/s）→ HuggingFace 兜底，共 5 次。**hf-mirror 已禁用**（308 无 ACAO，CORS 逐跳校验必失败） |
| 断点续传 | 会话内 + 跨会话（Cache Storage `?partial`，元数据在条目响应头 `x-model-bytes/total/etag/last-modified/saved-at`，读取三重一致性校验）；仅同源+强 etag 发 `If-Range` |
| 重试退避 | 指数退避、尊重 `Retry-After`、封顶 16s |
| 停滞看门狗 | 30s 无字节中断（下次从断点续）；进度心跳续期，杜绝无 Content-Length 的假超时 |
| 完整性校验 | 字节数不符不入缓存，绝不拼脏数据 |
| 多窗口去重 | storage 单键锁 `contextwatchdog.modelLock`（owner + 30s 心跳 TTL + 进度转发）；抢锁方等待显示「另一窗口下载中」，等待 ≤~5 分钟超时后自行下载；接管前再查缓存 |
| 缓存失效 | 缓存 key 固定（不带版本号）；命中后 1 字节探测（`Range: bytes=0-0`，5s 超时）**三级比对 ETag → Last-Modified → 总长**；⚠️ 浏览器跨源只读得到 CORS 安全列表头（ModelScope CDN 无 `Access-Control-Expose-Headers` → ETag/Content-Range 读不到，206 的 `content-length=1` 绝不当总长，否则 183MB ≠ 1 误判 stale → 每个探测窗重下 183MB，TC-06-9 回归）；离线/信息不可知时优先沿用缓存；旧 `?v=` key 一次性搬迁 |
| 单飞门闩 | `createSingleFlight`：并发加载复用同一 promise，重试不产生并行下载 |
| 内存释放 | `initialize()` 后置空对 183MB ArrayBuffer 的引用（ORT session 已持 wasm 堆副本）；前后打 JS 堆快照日志 |

**UI 语义**：只有确认走网络下载（`onDownloadStart`）才显示 toast 与进度条；
**缓存命中全程静默**（仅 console 日志），杜绝「先闪首次需下载再变已命中」的误导。

## 8. 粘贴自动拦截

- **授权模型**：`optional_host_permissions`（`https://*/*` + `http://*/*`，
  不含宽泛的 `<all_urls>`）+ 运行时 `chrome.permissions.request`（必须用户手势）
  ——**不申请 `<all_urls>`**，未授权站点零接触；
- **站点条目语义**（`engine/src/sites.ts`）：裸域名一并覆盖其子域
  （`deepseek.com` 命中 `chat.deepseek.com`，无需逐个添加）；带路径的条目按目录
  边界命中（`/docs` 命中 `/docs` 与 `/docs/x`，不命中 `/docspage`）；写 `http` 的
  条目视为协议不限；多条命中时取最具体的一条（路径最长，再看主机名最长）。
  授权时一并申请 `*.` 子域 origin，否则子域匹配得到却没有注入权限；
- **注入时机**：`tabs.onUpdated`（loading 且 URL 匹配）+ 站点列表变化时对已开页面即时注入；
  `chrome.scripting.executeScript({ allFrames: true })`，无 manifest 常驻脚本；
- **就地替换策略**：input/textarea 走「先插入后就地替换」（不阻塞输入）；站点规范化
  与匹配在 `engine/src/sites.ts`（单测 24 例）；插入区间推导与改写守卫为纯函数
  （`content/pasteText.ts`，单测 6+2 例）；
- **contenteditable 策略**：富文本区域做不了逐字校验（innerText 与 Range.toString 对
  `<div>/<br>` 的换行建模互不一致、Lexical/ProseMirror 类编辑器会重排 DOM）→
  「阻止默认 → 选区快照 → 检测 → `execCommand('insertText')` 插入」：快照 Range 随
  后续 DOM 编辑自动调整（语义等价「文本发散即放弃」守卫且更稳），走编辑器标准输入
  管线（beforeinput/input + 撤销栈），异常路径一律补插原文不吞粘贴；
- **轻提示**：改写生效时视口右上「已脱敏 N 处」（2s 自消、pointer-events:none、
  纯内联样式——不依赖也不污染宿主页面的 CSS/主题）；
- **守卫**：`password`/隐藏输入框绝不处理；input/textarea 插入文本与剪贴板逐字吻合
  才改写；检测期间用户继续输入（文本发散）即放弃；单次超 20,000 字符在入口层直接
  真放行（此前仅 SW 侧 slice 截断检测范围，入口照单全收会用截断结果整体改写、
  吞掉尾部文本——已修）；
- **AI 二次升级**（Chrome/Edge）：input/textarea 粘贴时，正则结果先落地并立即回写；
  SW 在回包之后按「全局 AI ∧ 本站 AI ∧ 宿主就绪」决定是否让 offscreen 宿主重跑一次完整检测。
  四道守卫（用户未继续输入 / 正则结果仍在原位 / AI 确有增量 / 8s 内）全部通过才二次替换，
  toast 改为「AI 增强后共脱敏 N 处」；失败或超时一律保留正则结果，绝不回退原文。
  contenteditable 本期仍只走正则档。
- **已知限制**：Firefox 无 `chrome.offscreen`，粘贴链路的 AI 升级不可用（侧栏手动检测仍可用）；
  其他浏览器未授权站点零注入、零接触。

## 9. 权限与安全模型

**权限逐项理由**（`manifest.json`）：

| 权限 | 用途 |
|------|------|
| `sidePanel` | 侧栏主界面 |
| `storage` | 档案/AI 开关/受保护站点/模型锁持久化 |
| `clipboardWrite` | 脱敏结果与档案 JSON 复制 |
| `unlimitedStorage` | 183MB 模型缓存配额 |
| `scripting` | 仅向已授权站点注入粘贴监听 |
| `offscreen` | 模型宿主（Chrome/Edge；Firefox 构建会移除） |
| `optional_host_permissions` | 粘贴拦截逐站授权（https + http，运行时按需申请；条目可带路径） |

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
| `contextwatchdog.activeProfile` | 激活档案 id |
| `contextwatchdog.aiEnabled` | AI 增强开关 |
| `contextwatchdog.aiOnboardingSeen` | 首启引导已看标记 |
| `contextwatchdog.userProfiles` | 用户自定义档案全量（CRUD 持久化） |
| `contextwatchdog.protectedSites` | 粘贴拦截授权站点列表 |
| `contextwatchdog.siteAiEnabled` | 逐站 AI 开关（`Record<pattern, boolean>`，缺省关闭） |
| `contextwatchdog.modelLock` | 多窗口下载锁（owner + 心跳 TTL + 进度） |
| `contextwatchdog.lastModelProbe` | 缓存探测节流戳（24h） |
| Cache Storage `?partial` 条目 | 模型断点续传分片（元数据在响应头） |
| Cache Storage `contextwatchdog.invalid/models/...` | 模型成品缓存（合成 origin，规避扩展页 HTTP 缓存差异） |

**chrome.storage.session**：`contextwatchdog.modelHost` 保存宿主状态
（phase / percent / received / total / waiting / downloadStarted / error / updatedAt），
由 offscreen 宿主经 Port 上报、SW 代写；侧栏订阅 `storage.onChanged` 渲染。

## 11. 构建与双目标

- 技术栈：Vite + CRXJS（单一输入 manifest，靠 `side_panel`/`service_worker` 发现打包入口；
  分叉输入会漏打包）+ vue-tsc 类型检查 + vitest；
- `npm run build` → Chrome `dist/`；
- `npm run build:firefox` → `vite build --mode firefox` 仅切 outDir，键转换集中在
  `scripts/postbuild.mjs`：`service_worker → scripts`、`side_panel → sidebar_action`、
  移除 `sidePanel` 权限、补 `browser_specific_settings.gecko`
  （`contextwatchdog@contextwatchdog.invalid`，min 121）；
- SW 运行时探测 `chrome.sidePanel.open` → 回退 `chrome.sidebarAction.open`，
  同一份 SW 代码服务双浏览器；**面板开合状态查询同样分叉**（`background/panelState.ts`）：
  Chrome/Edge 走 `runtime.getContexts`「存在即打开」（复数 filter）；Firefox 既无该
  API 也无任何侧栏开关事件，走 `sidebarAction.isOpen()` ∪ 弹窗兜底窗口的
  `storage.session` 自追踪（`windows.get` 探活 + `type === 'popup'` 复用防线，零新增
  权限）。FF 上挂件点击受 user-gesture 限制（content script 消息不算手势，MDN /
  bug 1800401）必开弹窗兜底，按钮文案按 `panelKind` 形态如实显示（「打开脱敏面板」/
  「面板已打开」，不冒充侧栏）；
- **vite root 指向 `packages/extension`**（而非仓库根）：manifest 入口路径保持包内
  相对形式（`src/sidepanel/index.html`），产物布局与重构前逐字节一致，运行时无需改
  `chrome.runtime.getURL`。副作用：Tailwind 扫描范围恰好收敛在扩展包内（扫仓库根会把
  `package-lock.json` 里的英文单词当类名）；`scripts/postbuild.mjs` 抽查产物 CSS 的
  utility 与设计 token，缺任一即构建**硬失败**；
- 设计 token 经别名 `@tokens/tokens.css` 被 `style.css` 引用，**产物内完整内联**
  （同样有构建期校验）。

### 11.1 落地页（`apps/site`）

Astro 静态站点（`output: 'static'`），产物是纯 HTML + 一个 CSS 文件，**零客户端 JS**
（`dist` 下不会出现 `.js`）。命令（仓库根执行）：`site:dev` / `site:build` /
`site:preview` / `site:check` / `site:evidence`。

> **不要**在 `apps/site` 里单独 `npm install`：仓库未启用 npm workspaces（留到本地代理
> 阶段），Astro 装在仓库根 `devDependencies`，脚本用 `astro --root apps/site` 调用。

三条不改的原则：

1. **视觉来自 `packages/design-tokens/tokens.css`**（经 `@tokens` 别名 `@import`），
   与扩展同一个源——两边配色/圆角结构上不可能漂移。站点不引 Tailwind。
2. **版本号与测试数不手写**。版本号构建期从 `packages/extension/src/manifest.json` 注入
   （`vite.define` → `__EXTENSION_VERSION__`）；测试数与探针数由
   `npm run site:evidence` 跑一遍真实套件后写入 `evidence.json`。
3. **未上架的渠道不渲染成链接**。渠道 URL 为空时页面显示「即将上架」，而不是一个点了
   打不开的 URL。URL 来自 `apps/site/.env`（gitignored，模板 `.env.example`）——
   这些是**部署身份**（域名 / 商店页 / 备案号 / 收款码），不进仓库，因为 fork 之后
   不该静默继承别人的它们。

结构要点：`src/pages/{index,en/index,privacy,en/privacy,changelog,…}.astro` 双语四类页；
`src/layouts/Base.astro` 管 `<head>`（hreflang / canonical / og）+ 页头页脚；
`src/i18n/{zh,en}.json` 两语言键集合一致由单测强制（部署前检查清单随发布 runbook
移出仓库，作者自持）。

## 12. 测试体系

`npm test`：**420 断言 / 33 文件**（`npm run typecheck` 0 错误为另一道闸）：

| 目录 | 内容 |
|------|------|
| `tests/golden/`（4） | 按档案分组的端到端金样例（universal / text / code / 白名单） |
| `tests/unit/`（26） | 场景启发式 / 占位符 / 校验算法 / 替换引擎 / 用户档案 CRUD 与 IO / 模型下载器（续传·退避·看门狗·完整性·缓存·锁·单飞）/ 检测 store 状态机 / 站点匹配 / 粘贴就地替换 / i18n 防漂移 / 区域规则集（US·EU）/ 规则与值过滤 / 短密钥族 / 自定义规则 ReDoS / 管线配置 / 引擎边界断言 / 落地页感谢墙分档与双语词典护栏 |
| `tests/regression/`（2） | 历史缺陷回归（含@密码、重复值、重叠、CJK 偏移、吞值） |
| `tests/perf/`（1） | 长文本基准（5000 字 < 2s） |

原则：下载器/管线等纯逻辑全部依赖注入，node 环境可单测；真机判定项（视觉/真实下载/
权限弹窗/真实推理）收敛到 `docs/test-cases.md`，不与自动化重叠。

## 13. 已知限制

1. Firefox 无 `chrome.offscreen`：粘贴链路的 AI 二次升级不可用（正则档不受影响），
   侧栏手动检测仍走 LocalHost；Chrome/Edge 的粘贴 AI 需要全局 AI + 本站 AI + 宿主就绪；
2. AI 模型 ~183MB 首次下载依赖网络（支持断点续传与多窗口去重）；
3. GLiNER 对自由文本（无格式姓名/地址）的召回依赖模型能力，中低置信默认仅提示；
   2026-10-18 实机：中文真召回为零，0.25–0.65 区间多为单字幻觉（「户」→姓名 0.456、
   「订」→邮箱 0.330），已由形状门禁（`entityShape.ts` 的 `isPlausibleEntity`）拦截；
   形似词幻觉（如 2 字词→姓名）仍可能通过，属模型能力限制，换更强模型才能收敛；
4. tokenizer/config 由 gliner 内部 transformers 下载，走其自带缓存，不受 §10 版本管理。

## 14. 实测数据（2026-10-18，Chrome，TC-06-4 / A-4 结案）

- JS 堆快照（`performance.memory.usedJSHeapSize`；Chromium 专有，Firefox 静默跳过），
  走缓存命中路径（模型 174.9MB 从 Cache Storage 物化为 ArrayBuffer）：

  | 时点 | JS 堆 | 说明 |
  |---|---|---|
  | 模型下载完成 | **179.3 MB** | ≈ 模型 ArrayBuffer + 页面基线，符合预期 |
  | 初始化完成并释放引用（未 GC 时刻） | **224.5 MB** | 高于前值属正常：ORT 建会话在 JS 侧解析 175MB protobuf 的对象图转为垃圾、`modelBuffer` 局部绑定尚在 `runLoad` 作用域（async 跨 await 保守保活），GC 前均计入 `usedJSHeapSize` |

- 口径说明：模型本体在 ORT wasm 线性内存，**不计入** `usedJSHeapSize`；此组数值仅验证
  JS 侧引用管理（§7 下载器表「内存释放」行），不代表进程总内存。

## 15. 项目结构与引擎边界

`packages/engine` 是检测与替换引擎：**纯 TypeScript，宿主无关**——同一份代码服务多个宿主：

| 宿主 | 用途 |
|------|------|
| 扩展（Chrome service worker / 侧栏） | 浏览器内正则 + AI 级联检测 |
| 扩展 offscreen（Firefox 侧栏为 LocalHost） | GLiNER 模型宿主 |
| Node（本地脱敏代理，后续迭代） | CLI / IDE / agent 出网前拦截 |

```
packages/
├── engine/                  # 检测与替换引擎（纯逻辑，宿主无关）
│   └── src/
│       ├── detector/
│       │   ├── pipeline.ts        # 主管线（级联调度 + 仲裁 + 值传播）
│       │   ├── backend.ts         # InferenceBackend 抽象 + 单例注入 + 置信度分档
│       │   ├── profiles.ts        # Profile 注册表（场景配置）
│       │   ├── sceneDetector.ts   # 场景启发式（纯规则，无模型）
│       │   ├── entityShape.ts     # 实体形状门禁（拦截模型幻觉）
│       │   └── rules/             # 规则模块（按类别分组）
│       │       ├── envPasswordRules / kvRules / dbPasswordRules
│       │       ├── apiKeyRules / privateKeyRules / emailRules
│       │       ├── piiRules       # 手机号/身份证/银行卡/IP/车牌
│       │       ├── usRules        # 社保号/税号/北美电话（号段校验）
│       │       ├── euRules        # IBAN（mod-97）/增值税号（逐国格式）
│       │       ├── highEntropyRules / valueFilters / constants
│       │       └── scanner        # 扫描器（类别开关 + 类型合并）
│       ├── replacer/              # 替换引擎（纯函数 apply）
│       │   ├── placeholder.ts     # 语义化占位符（分语言，生成/反解析）
│       │   └── mapping.ts         # 映射表（同值共享）
│       ├── sites.ts               # 受保护站点规范化/匹配（粘贴拦截）
│       ├── messages.ts            # content ↔ SW 消息契约
│       ├── types/                 # 类型定义（DetectionType/ProfileConfig）
│       └── utils/id.ts            # 统一 ID 生成
└── design-tokens/                 # 设计 token 唯一来源（扩展与落地页共用）

packages/extension/                # 扩展（宿主层）
└── src/
    ├── model/                     # 模型宿主：GLiNER + onnxruntime-web + 下载器
    │   ├── contentDetector.ts     #   GLiNER 调用与就绪状态
    │   ├── modelDownload.ts       #   断点续传 / 多源回退 / 多窗口锁 / Cache Storage
    │   ├── localBackend.ts        #   把 GLiNER 适配成引擎的 InferenceBackend
    │   └── index.ts               #   宿主入口（installModelBackend / preloadModels）
    ├── components/                # Vue 组件（ProfileSelect/DetectionItem/PasteInterceptionSettings/CapabilityDialog…）
    ├── content/pasteText.ts       # 粘贴就地替换纯逻辑（区间推导与改写守卫）
    ├── stores/detection.ts        # Pinia（Profile 持久化 + 默认策略分层）
    ├── i18n/                      # 界面文案：单一 catalog，UI 与 _locales 共用
    │   ├── locales/{en,zh_CN}.json #   扁平词条（键名用 Chrome messages.json 的合法字符集）
    │   └── index.ts               #   t() / useI18n / typeLabel / profileLabel
    ├── sidepanel/                 # Side Panel 主界面
    ├── background/                # Service Worker（侧栏入口跨浏览器 + 粘贴检测服务 + 站点注入）
    ├── shims/                     # 构建期打桩（ort GPU 子路径）
    └── style.css                  # 引入 @tokens/tokens.css + Tailwind theme 映射

apps/site/                         # 落地页（Astro 静态站点，零客户端 JS——结构见 §11，
                                   # 部署前检查随发布 runbook 移出仓库）
public/                            # 仓库级共享静态资源（icons）
tests/  scripts/  docs/            # 测试 / 构建与探针脚本 / 文档（设计线两份同在
                                   # docs/ 顶层：防御性公开，索引见根 README）
```

**引擎边界**：引擎通过别名 `@engine/*` 被扩展引用（`tsconfig.json` 与 `vite.config.ts`
各自声明）。**引擎不依赖任何宿主 API**，本目录**禁止**静态 import：

- `chrome`、`node:*` —— 宿主 API，连 `import type` 都不行，必须注入适配器；
- `vue`、`pinia`、`reka-ui` —— UI 属于宿主层；
- `gliner`、`onnxruntime-web`、`onnxruntime-common`、`@xenova/transformers`、
  `@huggingface/jinja` —— 模型运行时属于宿主层，必须可替换；
- `packages/extension` 下的任何文件（反向依赖，`import type` 也算）。

**允许**：对宿主全局做 `typeof chrome === 'undefined'` 守卫式访问，前提是同时提供可注入
的适配器（`createChromeStorage` 这类）——引擎能在 Node 下被 vitest 直接跑起来、`tests/`
全部用例不需要浏览器环境，靠的就是这条。这条约束有自动化断言保护
（`tests/unit/engineBoundaries.test.ts`，含「本节禁用清单与测试一致」的对账）——它是
同一份代码能同时服务浏览器扩展与后续 Node 代理服务的前提。

模型运行时（`packages/extension/src/model/`）与检测管线（`packages/engine/`）之间
只有一道接口：`InferenceBackend`。宿主在启动时 `installModelBackend()` 注册自己的实现；
未注册时 `getInferenceBackend()` 返回 `null`，管线自动退化为纯正则。这也是 `tests/`
里全部用例能在 Node 下直接跑起来的原因。

## 16. 界面语言（i18n）

词条只有**一份**：`packages/extension/src/i18n/locales/{en,zh_CN}.json`。它同时供两个
消费方使用——UI 走自带 `t()`（需要运行时切换语言，字典必须进包），manifest 的
`__MSG_*__` 与 service worker 的 `chrome.i18n.getMessage` 走 `_locales/*/messages.json`
（Chrome 原生机制，且不必把字典打进 SW 包）。后者由 `scripts/generate-locales.mjs`
在构建时从前者生成，**不手抄**。

键名一律 snake_case：Chrome 的 `messages.json` 只接受 `[a-zA-Z0-9_@]`，用点号分层
就无法共用一份清单。

语言来源：`contextwatchdog.locale`（localStorage，显式选择，同步可读）→
`chrome.i18n.getUILanguage()` → `navigator.language` → `en`。设置入口在侧栏的
「检测引擎状态」面板里。

**占位符也会跟着语言走**：替换后写进文本的是 `<<手机号>>` 还是 `<<PHONE>>`，取决于
当前界面语言。引擎自己读不到浏览器 API，因此由宿主在启动时 `setPlaceholderLocale()`
注入；解析侧同时接受两种语言的名称，所以切换语言后旧映射表仍可还原。

`tests/unit/i18n.test.ts` 兜住四类「构建全绿、界面才露馅」的漂移：新文案只写中文、
词条只加了一门语言、`t('xxx')` 拼错、manifest 的 `__MSG_*__` 没有对应词条。
