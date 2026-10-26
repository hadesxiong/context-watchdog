# Changelog

> ContextWatchdog 实现轮次与结案记录（按时间倒序）。
> 技术规格：`docs/spec.md`；手动验收判据：`docs/test-cases.md`；当前状态：`TODO.md`；设计线两份在 `docs/`。
> 逐笔改动见 `git log`；被清退的历史规划文档见 `f35ceae` 之前的 TODO。

## 2026-10-26

### ㉝ 落地页接入自托管 Umami 访问统计（env 门控 + 承诺精确化）

- 注入通道：`UMAMI_WEBSITE_ID / SCRIPT_URL / HOST_URL / DNT` 四键进 `apps/site/.env` → `resolveUmami` 纯函数校验 → `vite.define __UMAMI__` → `Base.astro` 条件渲染，模板零字面量；仅 `astro build` 注入，fork 默认零注入、产物逐字节同形；`check:versions` 外链检查改为 env 白名单。
- 部署架构：Umami 主机挂 Tailscale 内网零公网暴露，ECS nginx 把域名根的 `/umami/` 反代回源（收紧版只放行 `script.js` + `/api/`），访客只与本站域名通信。
- 承诺精确化（中英同步）：扩展零遥测承诺不动；站点侧字面承诺改为「作用域 + 条件披露」（页脚/隐私页条件键、README 双语、SECURITY、spec §11.1「默认零客户端 JS」），每种构建产物的声明都为真。

## 2026-10-23

### ㉑ 去掉 design/ 层级 —— 设计线三份平铺进 docs/

- `docs/design/` 三份 `git mv` 至 `docs/` 顶层、目录撤销，分组语义交回 README 文档地图与 CONTRIBUTING 索引。
- 全仓活引用跟随（12 文件 18 处：README 双语地图、spec §15 结构树、TODO、PATENTS、落地页 footer、check-docs 模式表等）；历史提及按存档不改。
- 五道门禁复验：check:docs / typecheck / test 420·33 / site:build / check:versions。

### ㉒ 移出 license-patent-and-brand.md（可执行内容已由关键文档承载）

- 定案类「思路性」文档撤出公开面：可执行内容分布在 `LICENSE` / `PATENTS.md` / `NOTICE` / `THIRD-PARTY-NOTICES.txt` / 根 README / `CONTRIBUTING`。
- 决策轨迹、被排除选项与注册建议按作者裁决不再随仓公开；引用跟随，docs/ 现为 5 份。
- 排期：`docs/releasing.md` 计划 1.0.0 发布完成后移出（㉓ 提前执行）。

### ㉓ 移出 releasing.md，并对两份文件做全历史清除（作者裁决升级）

- 作者个人发布 runbook 移出仓库（fork 者无法照单重跑作者的商店账号操作），仓外另存备份。
- `filter-branch` 将其与 license 文档共 3 条历史路径自全部 140 个提交抹除，仅后 46 笔改写哈希，需 force push。
- 引用跟随（README / spec / CONTRIBUTING / TODO / `links.ts` / pack-release）；docs/ 收敛为 4 份：spec / test-cases / 设计线两份。

### ㉔ 真机验收全结案；test-cases 精简为 A 类并全历史清除（作者裁决）

- 验收结案：Firefox 两缺陷（⑱）与 TC-02 卡号 Luhn 复跑（⑲）真机复验通过，1.0.0 真机验收全部清零。
- test-cases.md 只留 A 类（环境准备、样例夹具、真机判据主干、附录 A）：454 → 425 行，TC 编号骨架保留，B/C/D 成分移出仓外。
- `filter-branch` 使该文件仅本轮精简版所在提交持有 → 需 force push；入站引用逐一核对有效。

### ㉕ test-cases 再收敛 —— 验收判据明细出仓，只留样例与 TC 索引（作者裁决）

- 裁决：TC 的步骤与逐条预期是发布 QA 过程产物（随 UI 改动即腐烂），出仓归档；样例夹具是可复用公共输入，开放保留。
- 仓内最终形态 425 → 179 行：§0 环境 + 样例 A–F + **TC 索引（编号 + 标题 + 一句判据，保证 spec/源码的 TC 引用可解析）** + 附录 A。
- 二次全历史清除（仅最终 tip 持有该文件）→ 需 force push；README/CONTRIBUTING/spec/TODO 引用跟随，4 处源码 TC 引用零改动。

### ㉖ 修复「中文 AI 召回为零」缺陷 —— 换用多语言 GLiNER 模型

- 定性：前代模型 deberta-v3-small 纯英文词表对中文全盲（字符塌缩 `[UNK]`），「AI 补姓名/地址」承诺不成立——属选型问题，spec §13-3 重写。
- 换模 `onnx-community/gliner_multi-v2.1`（349MB）：`max_width`/span-level 同构、镜像源同组织，接线与白名单零改动；下载器换字节与缓存 key、清前代孤儿缓存。
- 代价如实：183 → 349MB、推理 5–6 倍；复验不过则回退（㉚ 兑现），期间不演示未验证输出（㉗）。

### ㉗ 落地页演示区改版（E8 占位收口）与 TODO 开源化精简

- demo 区删「演示动图」占位（作者裁决不做），改两组案例列表（占位符名与 `placeholder.ts` 双语名表对齐）；AI 案例待 ㉖ 复验通过再补。
- 换模文案补遗：隐私页模型 ID、三处「约 180MB」→ 350MB、下载进度恒显百分比 + MB（十进制口径）、前代历史缓存 key 纳入清扫。
- TODO 开源化精简（作者裁决）：只留状态/基线/回归命令/空待办，长叙事与个人运维迁出仓外。

### ㉘ 修复模型下载源指向前代模型（换模漏改）+ 缓存期望字节数守卫

- 真机报障「下载仍 183MB、AI 零召回」：㉖ 换模漏改 `MODEL_SOURCES`——分词器已是 250K 词表而 ONNX 仍指前代，推理失败被静默吞掉，两个症状一条根。
- 修复：`MODEL_SOURCES` 更正为 multi-v2.1 双源，重载后由守卫自动清污染缓存重下。
- 新增期望字节数守卫（缓存层不变式：只允许 `MODEL_FILE_BYTES` 字节持久化）：不符即删/拒写自愈，专治「完整下完的错文件」；+3 单测，423 tests · 33 files。

### ㉙ 换用 FP16 模型字节 —— int8/uint8 量化导出取证为坏文件

- 本地 harness 取证：多语言版 `model_int8`/`model_uint8` 在所有语言上输出全负 logits（quanto 量化算坏打分头）；`model_fp16` 完好（英文 0.97、中文姓名 0.90/0.72、推理 ~0.5s，web 端到端复核通过）。
- 变更：源切 `model_fp16.onnx`（579,717,643B），旧 int8 条目纳入清扫，守卫（㉘）自动拒收 349MB 坏字节；文案 350 → 580MB。
- 余项：真机复验待执行——若内存再异常则回退（㉚ 兑现）；spec §13-3 增量化崩坏取证条。

### ㉚ 回退 small-v2 —— 无任何可 ship 的 multi-v2.1 变体（FP16 内存实测判死）

- 内存矩阵判死：WASM 无 fp16 算子，fp16/q4f16 权重双份驻留 3.2GB / 2.8GB（vs small-v2 int8 1.5GB 流畅基线）均 2× 超标，q4f16 中文质量还衰减——上游无可 ship 变体。
- 裁决：回退 `gliner_small-v2`（1.0.0 终态，183MB 口径回归），中文 AI 召回转 1.1 路线（本机 torch 重量化 + GitHub Release 托管）。
- 新增 `languageGuard.ts` CJK 守卫（AI 级联整段跳过中文占优片段，消灭幻觉面）；孤儿缓存清扫 + 防与现役 key 交集不变式；spec §13-3/§13-4 重写，433 tests · 34 files。

### ㉛ 中文能力说明去绝对化 ——「完全由正则覆盖」改为稳妥口径（作者复审）

- 作者复审：「中文完全由正则覆盖」过于绝对（模式集无法兑现「全」；姓名/地址两档均不识别）。
- 站点双语统一稳妥口径（`engine.note` + FAQ）：AI 对部分通用中文不稳定，固定形状目标由正则负责、不作全覆盖承诺，多语言在路线图。
- 工程文档同步去「全」（spec §3/§13-3、`languageGuard` 头注）；扩展侧三重缓冲文案维持不动。

### ㉜ 移除打赏与感谢墙 —— 配置链整体下线（作者裁决「用不到了」）

- 落地页打赏区块与感谢墙整体删除（名单为空的休眠配置），联动删双语词条、样式、组件与 8 例单测；头部注释 9 → 7 区块。
- 配置链下线：`DONATE_QR_*` env 键、解析与断言、构建期 data-URI 内联、导出与声明、gitignore、CONTRIBUTING 部署表行全链清零。
- 基线 433/34 → **425 断言 / 33 文件**，check:docs 六处 + TODO + spec §12 同步。

## 2026-10-22

### ⑯ H-1 / H-2 与 TC-07-8/9 真机验收结案

- H-1 输入区去自动检测（仅「检测」按钮触发）与 H-2 落地页安装区改版（下载按钮 + details 下拉、零 JS）真机验收通过。
- TC-07-8 站点挂件与逐站 AI 开关、TC-07-9 粘贴链路 AI 二次升级真机通过 → 第①条线（S1–S5）全量结案。

### ⑰ docs/README 整合与改名收尾

- 移出一次性规划与重复文档（release-1.0.0-plan / roadmap）；删 4 个子 README，独有内容并入 CONTRIBUTING / README 地图 / spec §11.1·§15（`engineBoundaries` 测试改为与 spec §15 对账）。
- 改名收尾：origin 指向 `hadesxiong/context-watchdog`；移出文档历史经 `filter-branch` 清除，push 需 `--force`。

### ⑱ Firefox 侧栏两缺陷修复（真机验收发现，方案 A 诚实降级）

- 挂件按钮文案撒谎：FF 的 `sidebarAction.open()` 只认用户手势、content script 消息不算（bug 1800401）→ 协议加 `panelKind`，文案按宿主选择（zh/en 原子同步），Chrome/Edge 不变。
- 侧栏状态恒 false：FF 无 `getContexts` 也无开关事件 → 抽 `background/panelState.ts`（Chrome 原路径零改动；FF 走 `sidebarAction.isOpen()` ∪ 弹窗自追踪，零新增权限），弹窗创建成功补广播。
- 单测 +17（panelState，403 → 420/33）；probe:widget 修 Windows 扩展 ID 推导（UTF-16LE 字节哈希）与 rmSync 重试，20 项全过。

### ⑲ 样例 B 银行卡夹具换 Luhn 合法卡号（真机验收发现）

- 夹具卡号 `6222021202021234568` Luhn 不合法（实跑余 5），文档却称「校验位合法、应检出」——预期永不可达；引擎行为正确，坏的是夹具。
- 换为同前缀合法 19 位 `6222021202021234563`，保住正例与 19 位上界覆盖；纯文档改动，基线 420/33 不变。

### ⑳ check:docs 文档结构门禁（结构审计收尾）

- 新增 `npm run check:docs`（`scripts/check-docs.mjs`）：机器校验 md 相对链接/锚点、README×2 地图 + CONTRIBUTING 索引与 `docs/` 文件集三方一致、测试基线跨文档一致（历史数字豁免）。
- 补上 ⑱ 遗漏的四处「当前性」基线（README×2 / spec §12 / 设计稿回归清单）对齐 420/33——建门禁对账时当场抓出。

## 2026-10-21

### ⑮ 挂件「已打开」状态查询修复（真机验收发现，最后一个已知问题）

- 根因：`runtime.getContexts` 的 filter 写成单数字段（`tabId`/`documentUrl`），运行时直接抛错被 catch 吞掉 ⇒ `panelOpen` 恒 false——该查询自 ⑩ 起就没对过。
- 语义改「存在即打开」（侧栏 context 不绑定标签页，按 tab 过滤不可行）；弹窗段同步改复数字段。
- probe:widget 扩到 20 项（两道新防线在缺陷态实测 FAIL、修复态 PASS），探针几何改按节点盒模型取中心修假绿；文档基线 18 → 20 项。

### ⑭ 命令行口令直连形态漏检修复（真机验收发现）

- `mysql -p'<口令>'` 等三形态漏检：旧规则要求旗标后必须空白 → 重写为分隔形/直连引号形/直连裸值形并存，span 只锚内层口令本体。
- 直连裸值精度锚进正则（首字符字母数字、体不含 `=`、必含符号位）：`-pretty`/`-P3306`/`-port=8080` 零误报；纯字母数字口令宁缺勿误不检出。
- span 按组长度精确定位（弃 `indexOf` 猜位）；单测 +11 → 403 项 / 32 文件。

### ⑬ 粘贴链路执行「保留」判定 + 挂件侧栏状态推送补全（真机验收发现）

- 粘贴拦截不再无条件全替换：keep/replace 判定上收 engine（`resolveDefaultAction` + `sanitizeWithProfile` 三链共用），SW 正则首答修掉丢档案问题，「保留」项粘贴后保持原文。
- 挂件状态推送补全：事件不带 tabId（工具栏开全局侧栏）时改为广播；`OPEN_SIDE_PANEL` 成功后主动推一次开态。
- 单测 +4（`sanitizeWithProfile`）→ 392 项 / 31 文件。

### ⑫ 散文口令与 sk- 厂商段密钥漏检修复（真机验收发现）

- 新增 `naturalPasswordRules`（关键词 + 必需连接词 + ASCII 值域三层精度防线），散文口令 `新密码是 …` 不再原样穿过；类型 ENV_PASSWORD、high 置信 ⇒ 默认替换。
- 新增 `sk-<厂商段>-<≥32 位小写 hex>` 规则并置 high，`sk-live-…` 不再只落高熵被 keep 放走；既有混合大小写 FP 防线不破。
- 单测 +13 → 388 项 / 30 文件；`engineBoundaries` 按引擎文件数自动展开。

### ⑪ 侧栏开关原生事件实时推送（`onOpened`/`onClosed`）

- SW 注册 `sidePanel.onOpened/onClosed`（Chrome 141/142+），事件即推 `panelOpen` 给顶层挂件按钮即时翻转；2s 轮询保留兜底。
- 新增消息契约 `SITE_AI_PANEL_STATE`（单字段单向推送，不动 opening/openFailed 生命周期；旧浏览器特性检测跳过）。
- probe:widget 扩到 18 项（推送开/关 → 按钮立即复位/置回）。

### ⑩ 挂件交互与站点匹配打磨（子域、按钮态、实时性、间距）

- 站点匹配支持子域（裸域名覆盖全部子域，授权连 `*.` origin 一起申请；多条命中取主机名最长者）。
- 「在侧边栏中打开」改状态控件（在途/成功/失败三态由 render 重建，修永久灰态）；SW 每 2s 同步真实开关，`SITE_AI_GET` 时预热宿主，「尚未就绪」改「正在启动」。
- 暗色边框 0.18 → 0.3、间距与字号放宽；probe:widget 扩到 16 项，sites 单测 24 项，全量 375。

### ⑨ 挂件主题配色 + 站点写法完善（含「打开侧栏」修复）

- 挂件与 toast 配色跟随页面明暗主题（注入侧禁写 `<style>`，色板 JS 取值走 CSSOM）；字号、圆角、暗色边框整体调优。
- 修「点了没反应」：`sidePanel.open()` 只认手势 → 同步发车（授权校验并行），API 不可用退 `windows.create` 弹窗，真失败就地提示。
- 站点写法完善：支持带路径（目录边界匹配）、http 视为协议不限、多条取最具体；SW 按 `sender.url` 解析条目，页面不上报 pattern。probe:widget 扩到 14 项，全量 371。

### ⑧ 页面挂件放大并换上白色 logo

- 收起按钮 28 → 44px（触控下限）、面板 248 → 280px；「AI」字样换看门狗 mark。
- mark 经 SW `?raw` 读源 SVG 换白随 `args` 传入落地（不看宿主 `img-src` 脸色、不加 WAR 条目）；换 logo 只改资产一处。
- probe:widget 扩到 11 项（穿透 closed Shadow DOM 断言两枚 svg fill）。

### ⑦ 品牌图标换新（新 logo 接入插件 / 落地页 / README）

- `public/icons` 清理定稿：`logo.svg`（看门狗）+ `logo-1.svg`（锁标，补 viewBox），新增 `logo-1-dark.svg` 暗色变体，README/站点/侧栏用 `<picture>` 切换。
- manifest 图标仍由 `npm run icons` 生成；落地页页头与侧栏换锁标；失引用的 `Logo.vue`/`Mark.astro` 删除；发布包按新图标重打。

## 2026-10-20

### ⑥ 挂件常驻（× = 收起）

- 挂件常驻：移除隐藏存储键与消息，`×`/`Esc`/点外只收起面板、右下按钮始终保留（旧残留值不读，零迁移）。
- 加固：MutationObserver 即挂 + 3s 心跳兜 `document.open/write`；瞬时失败不卸载；状态回包前开关一律禁用。
- probe:widget 新增「删 host 自动重挂」（共 8 项）；发布包重打。

### ⑤ S5：收尾（挂件探针 + 宿主销毁 + 文档）

- 新增 `npm run probe:widget`：无头 Chrome 实测授权站点挂件出现、iframe 内/未授权站点不出现、不产生横向滚动条；临时改 manifest 授权后原样恢复。
- 宿主销毁实测（offscreen 目标 1 → 0、session 快照清空）；spec / test-cases / releasing 文档同步；发布包重打。

### ④ S3：粘贴链路 AI 二次升级（数据面）

- 正则先落地、AI 只做增量、失败保留正则结果：`PASTE_DETECT` 加 `token`，SW 按 `effectiveAI` 决定 `detectViaModelHost`，成功回 `PASTE_AI_RESULT`。
- content script 四道守卫（未继续输入 / 正则结果在位 / AI 有增量 / 8s TTL）全过才二次替换并修光标；可测版 `planAiUpgrade()` 单测覆盖。
- contenteditable 本期只走正则，Firefox 无宿主不可用。实测 3 → 4 处；基线 360 tests / 29 文件。

### ③ S4：页面挂件与逐站 AI 开关（控制面）

- 授权站点右下自包含挂件，AI 生效 = 全局 × 本站 × 宿主就绪；未授权站点零注入，全局关/宿主未就绪时开关禁用并显示原因。
- SW 侧双校验：`sender.url` 推导 pattern 必须与请求一致且在授权列表（页面隔离世界消息不可信）；挂件全内联 + Shadow DOM，移除自动重挂。
- 删除站点时清理 `siteAiEnabled`/`siteWidgetHidden`；基线 352 tests。

### ② S2：侧栏改为模型宿主客户端

- Chrome/Edge 侧栏不自载模型：先探 `MODEL_HOST_STATUS`，支持则 `MODEL_HOST_ENSURE`，进度/就绪/错误全由 `storage.session` 驱动，失败或未就绪回退本地正则；Firefox 仍本地加载。
- 关全局 AI 发 `MODEL_HOST_CLOSE` 销毁 offscreen；ENSURE 立即回包（首下可能数分钟），失败写 error 状态避免面板转圈；组件零改动。

### 品牌改名：PasteGuard → ContextWatchdog

- 发布前纯身份调整、零行为变更：包名、9 个 storage 键前缀、扩展名/描述/标题/日志前缀/发布包名、站点与文档全同步；中文首次出现标注「文本守卫」。
- gecko id 占位 `contextwatchdog@contextwatchdog.invalid`，AMO 首次上传前替换。

### ① S1：offscreen 模型宿主骨架

- 模型运行时移出 UI 上下文进唯一 offscreen 文档（ENSURE/DETECT/PING + 协议/状态/客户端；SW 经 Port 路由、幂等创建、自动重连），`manifest` 加 `offscreen` 权限。
- 实测两发现：offscreen 只暴露 `chrome.runtime`（storage/i18n 为 undefined ⇒ 状态经 Port 上报、SW 代写）；chunk 仅 2.2KB 共用同批依赖，dist 仍 12MB。
- vite 入口必须写 `rolldownOptions.input`（Vite 8 下 `rollupOptions` 被静默丢弃）；Firefox 目标不产出口径；+`modelHost` 单测 10 例。

### 站点部署身份改走 `.env`（域名 / 商店链接 / 备案 / 收款码）

- 动机：这些值描述「这一份部署」，放仓库会被 fork 静默继承（canonical/商店/备案/收款码全成作者的——冒用备案是法律问题）。
- 新增 `.env.example` + `site-links.mjs`（纯函数 + 12 例单测），`vite.define __SITE_LINKS__` 注入；删 `links.json`（available 由 URL 是否为空派生）；仓库链接由 `package.json#repository` 派生，中文页镜像走 `GITEE_URL`、深度链接固定 GitHub。
- `check:versions` 改「env 合法性 + 产物自洽」两段；缺 `SITE_URL` 普通构建警告、`SITE_REQUIRE_URL=1` 发布构建直接失败；备案行留空不渲染；CONTRIBUTING 补第 5 步部署身份。

### 发布标签改为 `<version>-<target>`

- tag 形态 `1.0.0-ext` / `-site` / `-app`：不用 `v` 前缀；target 是发布产物边界而非渠道（一个 `-ext` Release 挂 Chrome 与 Firefox 双包）。
- 规则抽 `scripts/lib/version-tag.mjs`，check-versions 一次查三个 tag；「旧形态必须认不出来」是反向断言；版本核心禁预发布号（与 semver pre-release 段冲突）。
- 已知副作用：GitHub 自动判 pre-release，建 Release 时需手动取消勾选。

## 2026-10-19

### 1.0.0 发布前 · 验收体验修正

- 侧栏：「界面语言」移首位、标题改「设置」；修切语言不更新（SelectValue 快照）、长文本遮罩不上屏（rAF 时序，抽 `lib/paintBarrier.ts` + 顺序单测）、类别勾选压窄、按钮换行与聚焦态不一致。
- 落地页：删「设计取舍」块与两段说明；四渠道改矩形卡片一行；hero 去安装按钮；隐私承诺六条长度对齐。
- 权限收窄（去 `http://*/*`，仅留 https + localhost）；删未用 devDeps；基线 311 passed / 25 文件。

### 1.0.0 发布准备 A–F · 关键节点结案

- A 许可与文档（Apache-2.0 + NOTICE + PATENTS + CONTRIBUTING + SECURITY + 第三方声明生成器；不申请专利，转防御性公开）；B/C 目录重排（core → `packages/engine` 带边界断言护栏、`InferenceBackend` 宿主注入——全部用例可在 Node 直跑的前提）。
- D i18n + 区域规则集 + 能力矩阵（单一 catalog 供 `t()` 与 `_locales`、区域集默认全关、README 双语）；E Astro 落地页（静态、零客户端 JS、token 同源、未上架渠道渲染「即将上架」）；F 发布就绪（check-versions + pack-release，顺带补上漏发的 NOTICE，新增隐私页）。
- 基线（结案时）：typecheck 0 / 307 passed / 24 文件 + 五道新护栏。

## 2026-10-18

### 版本探测误判重下修复 · G-1 结案

- 缺陷「首下 → 二次打开重下 → 三次起正常」：ModelScope CDN 不发 `Access-Control-Expose-Headers`，1 字节探测把 206 的 `content-length=1` 当总长误判 stale；node 单测无 CORS 过滤故测不出。
- 修复（`c031a28`）：三级比对 ETag → Last-Modified → 总长（206 只信 Content-Range），皆无则沿用缓存离线优先；下载随条目存 `X-Model-Last-Modified`。
- TC-06-9 实测通过（含节流盲区复核）；基线 187 → 190。

### 四项后续候选落地 · F-1/F-2/F-3 结案

- 移除未用 `contextMenus` 权限；粘贴拦截强化（contenteditable 富文本、右上「已脱敏 N 处」轻提示、>20000 字入口层放行修吞尾）；短密钥族「前缀即证据」阈值策略（10 家独特前缀收录，无前缀短串维持不检测）。
- TC-07-6 / TC-07-7 / TC-02-7 实测通过。

### AI 推理链路实机修复与运行时收敛

- `modelType` 改 span-level（推理从未跑通的首因）、`maxWidth` 12、锁 onnxruntime-web 1.19.2；检出形状门禁（`entityShape.ts`）拦中文单字幻觉替换。
- ort wasm 资产本地化（`wasmPaths:{}` 走本地 + 打桩剔 21.3MB jsep）、移除 @huggingface/transformers：产物 ~34MB → ~12.1MB、断网推理可用、零 CDN。
- TC-06-5/8 实测通过；「中文零召回系模型能力限制」的归因后于 ㉖ 修正为选型问题。

### E 组 UI 收尾（`0d7a9b2`…`f35ceae`，7 commits）

- 档案下拉齿轮点击竞态修复；设置弹窗三段结构、底部四按钮、默认策略 Switch；引擎面板区块与入口齿轮化；输入焦点统一细 ring；拦截输入/添加按钮等高。
- TC-04-3 / TC-07-2 / TC-08-1~5 实测通过。

### 文档体系收敛

- TODO 清退过时规划（Phase 1-5 旧计划与 valueExtractor / MobileBERT / 50GB GLiNER 等）；四份阶段验证文档合并为 `docs/test-cases.md`（样例 A–F + TC-01~09）；`docs/spec.md` 技术说明成文。

## 2026-10-17

### D 组 UX 实测反馈（`6df1167`…`eb5b0da`，5 commits）

- 缓存命中全程静默（杜绝「先闪首次需下载」误导窗口）；档案下拉放大与齿轮绑定自定义档案；正则改恒开基础引擎、场景识别并入 AI；弹窗标题放大、边框 token 加深。
- TC-06-2/3、TC-04-1/2、TC-06-1、TC-08-1 实测通过（缓存静默语义后被版本探测缺陷破坏，随 `c031a28` 修复后完整成立）。

### 遗留项 A/B/C 收尾、粘贴拦截地基与探测首修（`684c7b2`…`95cbf29`）

- 下载健壮性（跨会话续传、多窗口去重锁、版本探测、内存释放）；死代码清理；粘贴自动拦截地基（逐站授权 + 先插后替 + SW 正则档）、Firefox 121+ 侧栏兼容、CSP 收紧；双目标构建消 manifest 警告。
- CRLF 多行粘贴静默失效修复；版本探测首修（盲区后于 2026-10-18 G-1 完成）；档案 Tab 下拉、引擎 Switch、置信度徽章、首启引导等 UI 迭代。
- TC-01-2 / TC-07-1 实测通过；样例 A 行 1 漏检系复制带前导空白（`^` 锚点失配），非缺陷。

## 2026-10-16

### Phase 1-5 与下载器地基（`7e8bbbe`…`0ce7d20`）

- Phase 1+2 正确性修复与双轨检测体系；Phase 3+4+5 工程化加固与自定义档案体系；shadcn 主题化、Logo、配置弹窗与 NER 下载修复。
- 模型下载源切换 ModelScope（修 transformers env 配置）；断点续传与缓存落盘，修假超时与重试无效。

## 2026-09-11 ~ 09-15 · v0.0.1 MVP（`a29cb7c`…`eddc86e`）

- 初版「AI 对话脱敏」浏览器插件 MVP：样式/overlay、模型接入与检测管线迭代。
