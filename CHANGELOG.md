# Changelog

> PasteGuard 实现轮次与结案记录（按时间倒序，压缩版）。
> 技术规格：`docs/spec.md`；手动验收判据：`docs/test-cases.md`；当前状态：`TODO.md`；
> 设计决策与后续迭代规划：`docs/design/`。
> 单条提交详情见 `git log`；被清退的历史规划文档见 `f35ceae` 之前的 TODO。

## 2026-10-19

### 1.0.0 发布准备 A–F · 关键节点结案

路线图见 `docs/design/roadmap.md`（A–F 六个关键节点）。本轮完成 A–D：

- **A 许可与文档**（`2c61c0b`）：`LICENSE`（Apache-2.0 全文）、`NOTICE`、`PATENTS.md`、
  `CONTRIBUTING.md`、`SECURITY.md`；`scripts/third-party-notices.mjs` 生成
  `THIRD-PARTY-NOTICES.txt` 并随产物分发（Apache-2.0 §4 / MIT 通知条款要求）。
  许可选型逐条对齐作者诉求——Apache-2.0 §4(b)(c)(d) 强制署名 + 标注改动 + 随附 NOTICE，
  §6 不授予商标。**不申请专利**，转防御性公开。
- **B/C 目录重排**（`fdda367`、`1307d06`）：`src/core` → `packages/engine`（宿主无关，
  带边界断言护栏）、`src` → `packages/extension`、设计 token 抽出 `packages/design-tokens`。
  引擎侧引入 `InferenceBackend` 抽象：模型运行时不进引擎，宿主注入；未注册时管线自动
  退化为纯正则——这也是全部用例能在 Node 下直接跑的前提。
- **D i18n + 区域规则集 + 能力矩阵**（`b3f1fe4`、`e18294b`、`51fd642`）：
  - 单一 catalog（`packages/extension/src/i18n/locales/*.json`）同时供 UI 的 `t()` 与
    manifest/SW 的 `_locales` 使用，后者构建时生成、不手抄；占位符语言随界面语言切换
  - 区域规则集 `us`/`eu` **默认全关**：SSN 号段校验、EIN 带标签 + 前缀校验、
    NANP 电话、IBAN mod-97、VAT 逐国格式
  - 能力矩阵面板（头部 ℹ）把三轴分开说明（界面语言 / 区域规则集 / 模型语言能力），
    唯一一处明确「模型语言能力不承诺」
  - README 双语（`README.md` 英文 + `README.zh-CN.md` 中文）；设计文档公开进 `docs/design/`
- **基线**：typecheck 0 error / **307 passed（24 文件）** / 双目标构建零警告 /
  `probe:layout` 全通过。新增护栏：引擎依赖白名单、产物 `ort-wasm` 恰好一份、
  `.vue` 无未翻译汉字、`_locales` key ≡ catalog、i18n 词条完整性。
- **E Astro 落地页**：`apps/site/`，`output: 'static'`，产物**零客户端 JS**；
  视觉 `@import` 自 `packages/design-tokens/tokens.css`（与扩展同源）；版本号构建期
  从扩展 manifest 注入；测试/探针数由 `scripts/site-evidence.mjs` 实测写入；
  未上架渠道渲染为「即将上架」而非死链（`links.json` 状态与链接不一致会让构建失败）。
- **F 发布就绪**：`scripts/check-versions.mjs`（版本一致性 + 许可文件随附 + 落地页 canonical +
  产物 `eval` 预检 + tag 占用；`--release` 模式回答「现在能打 tag 了吗」）、
  `scripts/pack-release.mjs`（打包 zip + `SHA256SUMS`，回读校验根目录有 manifest）；
  操作手册见 `docs/releasing.md`。**顺带修掉一处合规缺口**：产物此前只带了 LICENSE 与
  第三方声明，**漏了 NOTICE**（Apache-2.0 §4(d) 要求随附），构建不会因此报错，
  已补入包并加了硬护栏。另新增隐私权政策页（`/privacy/`、`/en/privacy/`，CWS 表单必填）。

待做：F7 互链（等 `siteUrl`）与 F8 打 tag（**由作者确认后执行**）；
另有三项待作者产出的资产：演示 GIF、打赏收款码、商店截图/promo。

## 2026-10-18

### 版本探测误判重下修复 · G-1 结案

- **缺陷**：实机「首次下载 → 二次打开重下 183MB → 三次起正常」。根因：ModelScope CDN 不发
  `Access-Control-Expose-Headers`，浏览器跨源读不到 ETag/Content-Range（CORS 安全列表外），
  1 字节探测把 206 的 `content-length=1`（`Range: 0-0` 的响应体长）当总长 → 183MB ≠ 1 误判
  stale → 清缓存重下；探测成功又刷新 24h 节流，缺陷被掩盖成「第三次起正常」。
  node 单测注入 fetch 无 CORS 过滤，故自动化测不出。
- **修复**（`226f5a6`）：三级比对 ETag → Last-Modified（CORS 安全列表头，恒可见）→ 总长；
  206 的总长只信 Content-Range（可见时）、200 才用 Content-Length；三级皆无信息 → unknown
  沿用缓存（离线优先）。下载与断点续传随条目保存 `X-Model-Last-Modified`。补浏览器视角专测
  3 例，测试基线 187 → 190。
- **验证**：TC-06-9 实测通过（含节流盲区复核：清 `pasteguard.lastModelProbe` 后探测真实执行、
  判定「版本一致」、零重下）。

### 四项后续候选落地 · F-1/F-2/F-3 结案

- `d6e03a0`：移除未使用的 `contextMenus` 权限声明（全 src 零引用）。
- `259affa`：粘贴拦截强化——contenteditable 富文本区支持（阻止默认 + 选区快照 +
  `execCommand('insertText')`，检测异常补插原文不吞粘贴、多行可整体撤销）；改写生效右上
  「已脱敏 N 处」轻提示（2s 自消、不堆叠、未检出无提示）；>20000 字符粘贴入口层真放行
  （修复此前仅 SW 截断、入口吞尾部文本的缺陷）。
- `c279f49`：短密钥族规则——「前缀即证据」阈值策略：独特前缀官方格式收录 10 家，
  Mailgun/Twilio 无分隔符置 medium；无前缀短串维持不检测（FP 不可控），
  「短但有上下文」由 env/kv 规则兜底。
- **验证**：TC-07-6 / TC-07-7 / TC-02-7 2026-10-18 实测通过。

### AI 推理链路实机修复与运行时收敛

- `e157024`：GLiNER `modelType` 改 `span-level`（推理从未真正跑通的首因）；`aee9dfd`：
  `maxWidth` 改 12、锁 onnxruntime-web 1.19.2。
- `44c4dd5`：检出形状门禁（`entityShape.ts`）——拦截 GLiNER 中文单字幻觉的错误替换
  （`户`→姓名、`订`→邮箱）。
- `93d229b` + `cfa58ff`：ort wasm 资产本地化（`wasmPaths:{}` 走本地 + webgpu/webgl 打桩剔
  21.3MB jsep）、移除 @huggingface/transformers——产物 ~34MB → ~12.1MB，断网推理可用、
  零 CDN 依赖。
- `a7085bf`：A-4 heap 实测数据回填 spec §14（179.3 → 224.5 MB 口径说明）。
- **验证**：TC-06-5、TC-06-8 实测通过；GLiNER-small-v2 中文真召回为零系模型能力限制
  （spec §13-4）。

### E 组 UI 收尾（`0d7a9b2`…`f35ceae`，7 commits）

- 档案下拉齿轮点击竞态修复；设置弹窗三段结构（标题固定/正文滚动/底部 sticky、分隔线通宽）、
  底部一行四按钮、默认策略改 Switch；引擎面板区块全宽贴边、描述 2 行省略、入口改齿轮；
  输入焦点统一细 ring；拦截输入/添加按钮等高；隐藏新标签页按钮。
- **验证**：TC-04-3 / TC-07-2 / TC-08-1~5 实测通过。

### 文档体系收敛

- `63cd1f0`：TODO 清退历史规划（Phase 1-5 旧计划与 valueExtractor / MobileBERT /
  50GB GLiNER 等过时条目）；
- `08742d0`：四份阶段验证文档合并为单份 `docs/test-cases.md`（样例 A–F + TC-01~09）；
- `7cb3585`：`docs/spec.md` 技术说明成文（开发者/技术评审定位）。

## 2026-10-17

### D 组 UX 实测反馈（`6df1167`…`eb5b0da`，5 commits）

- `6df1167`：缓存命中全程静默（杜绝「先闪首次需下载再变已命中」误导窗口）；`f676c97`：
  档案下拉放大、说明入选项、齿轮绑定自定义档案；`10a9a05`：正则改恒开基础引擎、场景识别
  并入 AI；`e4c1dfc`：弹窗标题放大一档、全局边框 token 加深。
- **验证**：TC-06-2/3、TC-04-1/2、TC-06-1、TC-08-1 实测通过（缓存静默语义后曾被版本探测
  缺陷破坏，2026-10-18 随 `226f5a6` 修复后完整成立）。

### 遗留项 A/B/C 收尾、粘贴拦截地基与探测首修（`684c7b2`…`95cbf29`）

- `684c7b2`（A 组）：下载健壮性——跨会话续传、多窗口去重锁、缓存版本探测、内存引用释放；
  `09527ed`（B 组）：废弃文件与死代码清理、Switch 把手颜色令牌化；
  `b03b6b6` + `1f51991`（C 组）：粘贴自动拦截（逐站授权 + 先插入后就地替换 + SW 正则档）、
  Firefox 121+ 侧栏兼容、CSP 收紧；`dc6c974`：双目标构建消除 manifest 键警告。
- `7aa2b4f`：CRLF 多行粘贴静默失效修复（剪贴板换行归一化 + 原生 setter + 放弃路径日志）。
- `3c9c700`：版本探测首修——跨源 ETag 误判清缓存改比总长、离线跳过、24h 节流（浏览器
  CORS 头可见性盲区后于 2026-10-18 发现并修复，见 G-1）。
- 同轮 UI 迭代：档案 Tab 改下拉（`db0df56`）、引擎 Switch 开关（`01c9945`）、置信度徽章
  高=红（`896e25c`）、首启引导弹窗（`76ae1e7`）。
- **验证**：TC-01-2 / TC-07-1 等实测通过；样例 A 行 1 顶格复核确认漏检系复制带前导空白
  （env 规则 `^` 锚点失配），非缺陷。

## 2026-10-16

### Phase 1-5 与下载器地基（`7e8bbbe`…`0ce7d20`）

- `7e8bbbe` Phase 1+2：正确性修复与双轨检测体系；`001e32d` Phase 3+4+5：工程化加固与
  自定义档案体系；`c61fbd4`：shadcn 主题化、Logo、配置弹窗与 NER 下载修复；
- `023e866`：模型下载源切换 ModelScope（修 transformers env 配置）；
- `bb9adb8`：断点续传与缓存落盘，修假超时与重试无效。

## 2026-09-11 ~ 09-15 · v0.0.1 MVP（`a29cb7c`…`eddc86e`）

- 初版「AI 对话脱敏」浏览器插件 MVP：样式/overlay、模型接入与检测管线迭代。
