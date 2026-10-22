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
npm run test            # 运行测试套件（420 项断言）
```

## 架构

三个运行环境各司其职：侧栏（Vue 3）、service worker（粘贴检测 + 按需注入）、注入到已授权站点的粘贴监听。检测分两档——恒开的正则档（配算法校验：ISO 7064 / Luhn / mod-97 / 号段），加上可选的本地 GLiNER 档（只看正则档未覆盖的片段）——之后是同一条后处理链：去重 → 重叠仲裁 → 值传播 → 同值同占位符。

更深的全部内容在 [`docs/spec.md`](docs/spec.md)：

| 主题 | 位置 |
|------|------|
| 总体架构与检测管线（含重叠仲裁 / 值传播） | §2–§3 |
| 规则体系与区域校验表（SSN / EIN / IBAN / VAT） | §4 |
| 档案系统与自定义正则 ReDoS 防护 | §5 |
| 替换引擎、模型与下载机制 | §6–§7 |
| 粘贴拦截守卫、权限与 CSP、存储清单 | §8–§10 |
| 双目标构建、测试体系、已知限制 | §11–§13 |
| 项目结构与引擎边界、界面语言（i18n） | §15–§16 |

## 可核验的隐私承诺

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

## 测试

```bash
npm test              # 全量（golden + 回归 + 单元 + 性能）
npm run test:watch    # 监听模式
npm run site:check    # 落地页：Astro/TS 诊断
npm run site:build    # 落地页：静态构建 → apps/site/dist
npm run check:versions # 版本/许可/canonical 一致性 + 商店提交预检
```

目录地图见 [`docs/spec.md`](docs/spec.md) §12；带判据的手动验收用例见 [`docs/test-cases.md`](docs/test-cases.md)。

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

## 文档地图

| 文档 | 是什么 |
|------|--------|
| [`docs/spec.md`](docs/spec.md) | 技术参考：管线、规则、档案、权限、存储、构建、测试地图 |
| [`docs/test-cases.md`](docs/test-cases.md) | 手动验收用例与通过判据 |
| [`docs/releasing.md`](docs/releasing.md) | 发布操作手册：tag、商店提交、素材清单 |
| [`docs/license-patent-and-brand.md`](docs/license-patent-and-brand.md) | 为何是 Apache-2.0、专利策略、商标与品牌政策 |
| [`docs/site-ai-offscreen-host.md`](docs/site-ai-offscreen-host.md) | 设计 ①：授权站点 AI 增强——页面挂件控制面 + offscreen 单一模型宿主 |
| [`docs/local-sanitize-proxy.md`](docs/local-sanitize-proxy.md) | 设计 ②：本地脱敏代理——拦截出网请求 + 白名单 + 溯源审计 |
| [`CHANGELOG.md`](CHANGELOG.md) | 实现轮次与结案记录 |
| [`TODO.md`](TODO.md) | 当前状态与未结事项 |
| 落地页 `/changelog/` | 面向用户的更新记录（中英双语） |

设计文档**有意随代码公开**：本项目不申请任何专利，设计本身即构成可实施的现有技术（见 [PATENTS.md](PATENTS.md)）。`site-ai-offscreen-host.md` 与 `local-sanitize-proxy.md` 描述 1.0.0 **之后**的两条线，现在就公开正是为了不留空窗期。

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
