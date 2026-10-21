# ContextWatchdog（文本守卫）

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/icons/logo-1-dark.svg" />
  <img src="public/icons/logo-1.svg" alt="ContextWatchdog（文本守卫）" width="260" />
</picture>

[English](README.md) | **简体中文**

ContextWatchdog（文本守卫）是面向 AI 工作流的本地检测与脱敏工具：在文本进入模型前，自动检出并替换敏感信息。当前形态为 Chrome / Firefox 浏览器扩展（Manifest V3），后续扩展到桌面端、CLI 与本地代理。**双轨检测**：通用文本 PII（手机号/身份证/银行卡/邮箱/车牌/IP）与开发场景密钥（API Key/密码/连接串/JWT/私钥）并重。所有处理在本地完成。

两种用法：

- **侧栏手动脱敏**（默认）：侧栏粘贴 → 检出列表 → 一键脱敏 → 复制
- **粘贴自动拦截**（可选，逐站授权）：在已授权站点粘贴时自动就地替换为占位符，无需打开侧栏

## 快速开始

```bash
npm install
npm run build           # Chrome 包 → dist/，加载到 chrome://extensions
npm run build:firefox   # Firefox 包 → dist-firefox/，about:debugging → 此 Firefox → 加载临时附加组件 → 选 dist-firefox/manifest.json
npm run test            # 运行测试套件（311 项断言）
```

## 架构

### 检测管线

```
输入文本
  │
  ▼
场景启发式（env/yaml/json/log/code/plain，零延迟离线可用）
  │
  ▼
正则规则（按 Profile 启用类别）
  ├─ secret 类别: ENV/YAML/JSON/连接串/API Key/JWT/私钥
  ├─ pii 类别:    手机号/身份证(校验位)/银行卡(Luhn)/IP/车牌/邮箱
  ├─ us 类别:     社保号(号段校验)/税号(带标签)/北美电话(NANP)  ← 默认关
  ├─ eu 类别:     IBAN(mod-97)/增值税号(逐国格式)                ← 默认关
  └─ entropy:     高熵字符串（阈值随 Profile 灵敏度档位变化）
  │
  ▼（级联触发，仅处理正则未覆盖片段）
GLiNER 模型（gliner + @xenova/transformers + onnxruntime-web，可选）
  ├─ 高置信(>0.65) → 验证后采纳
  ├─ uncertain(0.35-0.65) → 回流正则复检
  └─ 复检不中 → 低置信保留（默认仅提示）
  │
  ▼
去重 → 重叠归并仲裁 → 值传播 → 占位符按值共享
  │
  ▼
语义化占位符（zh_CN: <<手机号>> / en: <<PHONE>>，随界面语言切换）
```

### Profile（场景 Tab）

| Profile | 定位 | 特点 |
|---------|------|------|
| 不限（默认） | 全场景 | 规则并集 + 仲裁，中低置信度仅提示 |
| 通用文本 | 聊天/文档/工单 | PII 为主，高熵 strict（30 字符） |
| 代码开发 | 配置/代码/日志 | 密钥全开，高熵 loose（20 字符），PII 仅提示 |
| 美国个人信息 | 含美国数据的文本 | 在通用之上追加 `us` 类别（SSN/EIN/电话） |
| 欧盟个人信息 | 含欧洲数据的文本 | 在通用之上追加 `eu` 类别（IBAN/VAT） |

新增场景 = 在 `packages/engine/src/detector/profiles.ts` 加一条配置，无新代码路径。Profile 选择持久化于 `chrome.storage.local`。

### 区域规则集（`us` / `eu`）

区域规则**默认全关**，只有选了对应档案（或在自定义档案里勾上该类别）才参与扫描。这不是保守，而是误报控制：`\d{3}-\d{2}-\d{4}` 这种形状在任何地区的文本里都可能出现，把它塞进通用集会让所有非美区用户承担误报代价。

每条规则都带校验，裸正则在真实文本里不可用：

| 规则 | 校验方式 |
|------|---------|
| SSN（社保号） | 号段校验：排除区号 000/666/9xx、组号 00、序号 0000、三段全同数字 |
| EIN（税号） | **要求带标签**（EIN/FEIN/TIN/Tax ID）——裸 `\d{2}-\d{7}` 与日期区间无法区分；再校验 IRS 已分配前缀 |
| 北美电话 | NANP：区号与局号首位必须为 2-9（这一条即挡掉 `2024-01-0100` 这类日期） |
| IBAN | ISO 13616 mod-97（15~34 位任意串通过率约 1/97），紧凑与分组写法都收 |
| 增值税号 | 逐国格式表（希腊用 `EL` 而非 `GR`，这是 VIES 的定义） |

增值税号目前**只有格式校验**（无通用校验位），因此置信度为 `medium`；DE/FR 等逐国校验位属后续迭代。

### 自定义档案（Phase 4/5）

Tab 栏「＋」基于当前档案克隆出用户自定义档案（⚙ 按钮编辑），可配置：

- **检测类别开关**：密钥凭据 / 个人信息 / 高熵字符串
- **高熵灵敏度**：宽松（20 字符）/ 标准（25）/ 严格（30）
- **分类型默认策略**：10 种类型逐项选择替换/保留
- **值白名单**：每行一个精确值，命中不检测不替换（含值传播的所有出现）
- **AI 模型检测目标**：GLiNER 标签集（个人信息集/密钥集/全部/自定义）
- **自定义正则规则**（Phase 5）：零样本之外补位，带 ReDoS 双层防护——静态拒绝嵌套量词（星号高度检查）+ 运行时 50ms/条执行预算与匹配上限；结果走完整管线（去重/重叠归并/值传播/白名单）
- **JSON 导入导出**（Phase 5）：全部自定义档案经剪贴板导入导出；导入时重新生成 id、重名加序号、危险正则被 sanitize 过滤

自定义档案持久化于 `chrome.storage.local`（`contextwatchdog.userProfiles`），内置档案不可改删；数据经 sanitize 校验，存储损坏自动丢弃。实现细节见 `docs/spec.md`，用例见 `docs/test-cases.md`。

### 粘贴自动拦截（可选，逐站授权）

侧栏「粘贴自动拦截」卡片中添加站点（如 `chat.example.com`），浏览器会弹出该站点的访问授权。授权后：

- 在该站点的输入框 / 文本域粘贴时，**先正常插入原文**（不阻塞输入），检测完成后**就地替换**为占位符
- 检测在 service worker 中跑现有正则管线（GLiNER 模型不会在 SW 加载），无需下载模型
- 站点列表持久化在 `chrome.storage.local`（`contextwatchdog.protectedSites`），SW 按 `tabs.onUpdated` 按需注入粘贴监听——**未授权站点零接触**（manifest 不声明 `content_scripts`，也不申请 `<all_urls>`）
- 安全护栏：password/隐藏输入框绝不处理；插入文本与剪贴板逐字吻合才改写（站点改写粘贴内容则放弃）；检测期间用户继续输入则放弃改写，绝不覆盖新内容；未检出则完全不动

v1 范围限制：只支持 `input[type=text/search]` 与 `textarea`；`contenteditable` 富文本区域暂不处理（粘贴片段难以可靠定位，待后续版本）。

### Firefox 兼容

按目标浏览器分别出包，两边 manifest 均为「纯目标键」，加载零警告：

```bash
npm run build           # Chrome → dist/
npm run build:firefox   # Firefox 121+ → dist-firefox/
```

- 两个目标**共用同一份输入 manifest**（CRXJS 必须靠 `side_panel` / `service_worker` 发现打包入口，分叉输入会漏打包），`--mode firefox` 只切换输出目录
- 差异转换统一由 `scripts/postbuild.mjs` 在构建后完成：`background.service_worker → scripts`、`side_panel → sidebar_action`、移除 `sidePanel` 未知权限、补 `browser_specific_settings.gecko` id
- 侧栏打开：SW 内运行时探测 `chrome.sidePanel.open` → 失败回退 `chrome.sidebarAction.open`，两者打开同一面板页面
- 因此 Chrome 包不含 `sidebar_action`/`scripts`/gecko 键（不会报「requires manifest version of 2 or lower」），Firefox 包不含 `side_panel`/`sidePanel`/`service_worker`（无未知键/未知权限警告）

### 防泄漏保证

- **同值必同占位符**：同一敏感值出现 N 处 → N 处全部替换为同一占位符（值传播覆盖无上下文的裸露出现）
- **区间不重叠**：重叠检测项经仲裁归并（类型优先级：凭据 > PII > 高熵），替换输出永不互切
- **校验防误报**：身份证过 ISO 7064 校验位，银行卡过 Luhn，弱口令字典（含数字后缀变体）过滤

### 可核验的隐私承诺

以下每一条都可以直接在本仓库核验，而不是相信一句话：

| 承诺 | 核验方式 |
|------|----------|
| **扩展不会把你的文本发送到任何服务器** | `rg -n '\bfetch\s*\(' packages/extension/src` → 只有 `modelDownload.ts` 两处（且都是可注入的 `fetchImpl`，默认取 `globalThis.fetch`，仅用于下载模型）。全仓库无 `XMLHttpRequest` / `sendBeacon` / `WebSocket` / `EventSource` / `navigator.sendBeacon` |
| **唯一的出网行为是模型下载** | 同上。只有在用户主动开启 AI 档后才会发生，且只访问白名单模型源 |
| **未授权站点零接触** | `rg -n 'content_scripts\|all_urls' packages/extension/src/manifest.json` → 无匹配。manifest 不声明 `content_scripts`，只申请 `optional_host_permissions`，由用户逐站授权 |
| **不采集任何遥测数据** | 仓库内无统计 SDK、无崩溃上报、无行为追踪；构建产物可用 `npm run build` 后自行检查 |
| **凭据类数据绝不处理** | `password` 类型与隐藏输入框在 `isTextEditable` 处一律跳过，且在粘贴注入与侧栏两条链路上都有护栏 |
| **发布产物可校验** | 每个 Release 附 `sha256`；许可与第三方声明随产物分发（`LICENSE` / `NOTICE` / `THIRD-PARTY-NOTICES.txt`） |

同一份内容另有一份「可提交给商店」的政策正文，在落地页的 `/privacy/` 与 `/en/privacy/`。
改一处要一起改——审核是会拿两者对照的。

## 项目结构

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

apps/site/                         # 落地页（Astro 静态站点，零客户端 JS —— 见 apps/site/README.md）
public/                            # 仓库级共享静态资源（icons）
tests/  scripts/  docs/            # 测试 / 构建与探针脚本 / 设计文档
docs/design/                       # 设计决策与后续迭代规划（防御性公开，详见其 README）
```

引擎通过别名 `@engine/*` 被扩展引用（`tsconfig.json` 与 `vite.config.ts` 各自声明）。**引擎不依赖任何宿主 API**：不静态 import `chrome` / `node:*` / `vue` / `gliner` / `onnxruntime-web` / `@xenova/transformers`，宿主能力一律通过适配器注入。这条约束有自动化断言保护（`tests/unit/engineBoundaries.test.ts`）——它是同一份代码能同时服务浏览器扩展与后续 Node 代理服务的前提。

模型运行时（`packages/extension/src/model/`）与检测管线（`packages/engine/`）之间只有一道接口：`InferenceBackend`。宿主在启动时 `installModelBackend()` 注册自己的实现；未注册时 `getInferenceBackend()` 返回 `null`，管线自动退化为纯正则。这也是 `tests/` 里全部用例能在 Node 下直接跑起来的原因。

**vite 的 root 指向 `packages/extension`**（而非仓库根），这样 manifest 里的入口路径保持包内相对形式（`src/sidepanel/index.html`），产物布局与重构前逐字节一致，运行时 `chrome.runtime.getURL` 无需改动。副作用是 Tailwind 的扫描范围恰好收敛到扩展包内——扫描仓库根会把 `package-lock.json` 里的英文单词也当成类名。`scripts/postbuild.mjs` 会抽查产物 CSS 里的 utility 与设计 token，两者缺失都会让构建**硬失败**。

设计 token 通过别名 `@tokens/tokens.css` 被 `packages/extension/src/style.css` 引用，**且产物内会被完整内联**（同样有构建期校验）。

### 界面语言（i18n）

词条只有**一份**：`packages/extension/src/i18n/locales/{en,zh_CN}.json`。它同时供两个消费方使用——UI 走自带 `t()`（需要运行时切换语言，字典必须进包），manifest 的 `__MSG_*__` 与 service worker 的 `chrome.i18n.getMessage` 走 `_locales/*/messages.json`（Chrome 原生机制，且不必把字典打进 SW 包）。后者由 `scripts/generate-locales.mjs` 在构建时从前者生成，**不手抄**。

键名一律 snake_case：Chrome 的 `messages.json` 只接受 `[a-zA-Z0-9_@]`，用点号分层就无法共用一份清单。

语言来源：`contextwatchdog.locale`（localStorage，显式选择，同步可读）→ `chrome.i18n.getUILanguage()` → `navigator.language` → `en`。设置入口在侧栏的「检测引擎状态」面板里。

**占位符也会跟着语言走**：替换后写进文本的是 `<<手机号>>` 还是 `<<PHONE>>`，取决于当前界面语言。引擎自己读不到浏览器 API，因此由宿主在启动时 `setPlaceholderLocale()` 注入；解析侧同时接受两种语言的名称，所以切换语言后旧映射表仍可还原。

`tests/unit/i18n.test.ts` 兜住四类「构建全绿、界面才露馅」的漂移：新文案只写中文、词条加了一门语言、`t('xxx')` 拼错、manifest 的 `__MSG_*__` 没有对应词条。

## 测试

```bash
npm test              # 全量（golden + 回归 + 单元 + 性能）
npm run test:watch    # 监听模式
npm run site:check    # 落地页：Astro/TS 诊断
npm run site:build    # 落地页：静态构建 → apps/site/dist
npm run check:versions # 版本/许可/canonical 一致性 + 商店提交预检
```

| 目录 | 内容 |
|------|------|
| `tests/golden/` | 按 Profile 分组的端到端用例（universal/text/code/whitelist） |
| `tests/regression/` | Phase 1 修复点回归（含@密码/重复值/重叠/CJK 偏移/吞值） |
| `tests/unit/` | 场景启发式/占位符/校验算法/替换引擎/用户档案 CRUD/模型下载器/检测 store 状态机/站点匹配/粘贴就地替换/i18n 防漂移/区域规则集（US·EU）/落地页感谢墙分档与双语词典护栏 |
| `tests/perf/` | 长文本基准（5000 字 < 2s） |

手动验证用例见 `docs/test-cases.md`，实现细节见 `docs/spec.md`。

## 技术栈

- Vue 3 + Pinia + Tailwind CSS 4 + Reka UI
- @crxjs/vite-plugin（Manifest V3 构建）
- gliner + @xenova/transformers + onnxruntime-web（GLiNER 模型，WASM，可选增强）
- 模型远程加载（主源 ModelScope 镜像，回退 huggingface.co；Range 断点续传 + 指数退避重试 + 停滞看门狗 + Cache Storage 落盘，重开侧栏零下载；失败时静默降级为纯正则，UI 显示降级状态）

## 发布

```bash
npm run check:versions              # 版本一致性 + 产物随附许可文件 + 落地页 canonical
npm run check:versions -- --release # 「现在能打 tag 了吗」：要求一切都已就位
npm run release:pack                # 两个可直接上架的 zip + SHA256SUMS → release/
```

完整操作手册（tag、Release 附件、AMO 可复现构建源码包、三渠道提交、素材清单）见
[`docs/releasing.md`](docs/releasing.md)。版本号的唯一真相源是
`packages/extension/src/manifest.json`（商店读的就是它），`check:versions` 会强制其它地方与它一致。

## 第三方组件与模型归属

构建时会生成 `THIRD-PARTY-NOTICES.txt` 并随产物一同分发（Apache-2.0 第 4 条、MIT 的版权与许可通知均有此要求）。下面是人可读版本：

| 组件 | 用途 | 许可 |
|-------|------|------|
| vue / pinia / reka-ui | UI 框架与组件 | MIT |
| @crxjs/vite-plugin / vite / tailwindcss / typescript | 构建链 | MIT |
| gliner | 零样本文本实体识别 | Apache-2.0 ※ |
| @xenova/transformers | 模型运行时（transformers.js） | Apache-2.0 |
| onnxruntime-web / onnxruntime-common | ONNX Runtime（WASM 后端） | MIT |
| @huggingface/jinja | 模板引擎（transformers 依赖） | MIT |
| 模型 `onnx-community/gliner_small-v2`（运行时下载，不随包分发） | AI 检测 | Apache-2.0 |

> ※ `gliner` 的 `package.json` 声明为 MIT，但其包内 `LICENSE` 文件是 Apache-2.0 全文。**以 `LICENSE` 文件为准**，按 Apache-2.0 处理。这个差异已记录在 `THIRD-PARTY-NOTICES.txt` 中。

**一处值得注意的合规决策**：GLiNER 的 **v0 / v1 是 `cc-by-nc-4.0`（禁止商用）**，自 **v2 起改为 Apache-2.0**。本项目**锁定 v2**，这本身就是一次许可合规决策——如果误用 v1，本项目将无法以任何允许商业化的许可发布。

## 数据流与隐私声明

| 环节 | 数据去向 |
|------|----------|
| 文本检测与替换 | **本地**（service worker / 侧栏内存），不离开设备 |
| AI 模型推理 | **本地**（WASM / ONNX Runtime），不离开设备 |
| 模型下载 | 白名单模型源（ModelScope → huggingface.co 回退）；**仅下载模型文件，不上传任何用户数据** |
| 站点授权 | 逐站授权，存于 `chrome.storage.local`；未授权站点零接触 |
| 遥测 / 统计 / 崩溃上报 | **无** |
| 第三方分析 SDK | **无** |

**没有云、没有后端、没有账号体系。** 这是一个完全离线可用的本地工具——除了首次下载 AI 模型之外，断网状态下功能完整。

## 贡献方式

本项目由作者**单人维护**，**不接收代码合并请求**——这是有意的维护策略，不是对社区的拒绝（详见 [CONTRIBUTING.md](CONTRIBUTING.md)）。

欢迎：

- ✅ 提 Issue 报告误报 / 漏报 / 崩溃
- ✅ 分享使用场景与设计讨论
- ✅ Fork 后按自己的需求改造（须使用你自己的名称与图标）

## 署名与商标

- 本项目由 **hadesxiong** 开发并维护。
- **`ContextWatchdog` 名称与图标是作者的商标**，不在 Apache-2.0 的授权范围内（该许可第 6 条明确排除商标授权，只保留"描述来源"的合理使用）。
- 允许：事实性引用，例如 `Based on ContextWatchdog (https://github.com/hadesxiong/context-watchdog)`。
- 不允许：把 `ContextWatchdog` 用作你的衍生作品名称、图标或包名；暗示你的作品是官方版本或获得原作者背书。

详见 [NOTICE](NOTICE) 与 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 专利声明

本项目**不申请任何专利**（含后续全部迭代内容），全部设计文档与实现细节均以公开形式发布，构成可实施的现有技术。详见 [PATENTS.md](PATENTS.md)。

## License

本项目以 [Apache License, Version 2.0](LICENSE) 发布。

```
Copyright 2026 hadesxiong
```

你可以自由使用、修改、分发本项目，包括用于闭源商业目的——但须保留版权与 `NOTICE` 声明、标注改动，并使用你自己的名称与图标。
