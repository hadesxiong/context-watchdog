# Changelog

> ContextWatchdog 实现轮次与结案记录（按时间倒序，压缩版）。
> 技术规格：`docs/spec.md`；手动验收判据：`docs/test-cases.md`；当前状态：`TODO.md`；
> 设计决策与后续迭代规划：`docs/design/`。
> 单条提交详情见 `git log`；被清退的历史规划文档见 `f35ceae` 之前的 TODO。

## 2026-10-22

### ⑯ H-1 / H-2 与 TC-07-8/9 真机验收结案

- **H-1 输入区去自动检测**（2026-10-18 落地）真机验收通过 → **TC-02-1 结案**：
  粘贴与手动输入均不再自动检测，仅「检测」按钮触发；检测后继续编辑旧结果保留。
- **H-2 落地页安装区改版**（2026-10-19 落地）真机双语目视验收通过 →
  四并列渠道卡片改 VS Code/GitHub 式下载按钮 + details 下拉面板（零 JS）；
  应用组未上架渠道占位「即将上架」无死链；分割线评估=保留每节 1px 单色细线。
- **TC-07-8 站点挂件与逐站 AI 开关、TC-07-9 粘贴链路 AI 二次升级**真机验收通过
  → 第①条线（S1–S5）全量结案。

### ⑰ docs/README 整合与改名收尾

- **移出内部工作文档**：`docs/design/release-1.0.0-plan.md` 与 `docs/design/roadmap.md`
  移出仓库（roadmap 内容与 CHANGELOG 重复，plan 是已执行完的一次性规划），不再随分发。
- **删除 4 个子 README**，独有内容并入单一真相源：`docs/README.md` 文档索引与更新触发
  → `CONTRIBUTING.md`；`docs/design/README.md` 索引表 → 根 README 文档地图（双语同步）；
  `apps/site/README.md` → spec §11.1（落地页：命令/结构/三条不改的原则）+ releasing §7
  （部署前检查）；`packages/engine/README.md` → spec §15（三宿主表 + 硬约束禁用清单），
  `engineBoundaries` 测试改为与 spec §15 对账。
- **新增 `public/icons/logo-dark.svg`**（暗底用浅色变体，纯资产，暂无消费方）。
- **改名收尾**：origin 指向 `github.com:hadesxiong/context-watchdog`；两个移出文档的
  全部历史提交经 `git filter-branch` 清除（全仓库短 SHA 重写，push 需 `--force`）。

## 2026-10-21

### ⑮ 挂件「已打开」状态查询修复（真机验收发现，最后一个已知问题）

- **`panelOpen` 恒 false 的根因：`runtime.getContexts` 的 filter 字段写错**（验收现象：
  ⑪ 修完推送后按钮仍不实时——别处打开侧栏后挂件按钮仍是可点的「在侧边栏中打开」；
  点按钮后短暂「已打开」、约 2s 后被状态轮询翻回可点）：`isSidePanelOpen` 的两段查询
  都写成**单数**字段（`tabId` / `documentUrl`），而该 API 的 filter 只认**复数数组**形态
  （`tabIds` / `documentUrls`）——单数字段被运行时以 `Unexpected property` 直接**抛错**，
  外层 catch 吞掉返回 `undefined` ⇒ 挂件侧 `panelOpen = state.panelOpen === true` 恒为
  false。即这条查询自 ⑩ 落地起就没对过；探针此前只验「点击回包切已打开态」，恰好都在
  2s 轮询首个 tick 前收起了面板，轮询真值从未被覆盖到。
- **语义改为「存在即打开」**：实测侧栏 context 的 `tabId: -1`（不绑定标签页），按 tab
  过滤既不可行也无必要——工具栏图标、侧栏选择器、挂件按钮打开的侧栏一律算开；弹窗
  降级段同样改用 `documentUrls` 复数字段。代价：别个窗口开着侧栏时本窗口挂件也显示
  已打开（API 不给窗口关联，注释已写明取舍）。
- **probe:widget 扩到 20 项**：新增「展开态轮询一个周期后仍保持已打开（不被
  panelOpen=false 翻回）」与「页面重载后挂件初始即已打开禁用态」两道回归防线——
  两项都在缺陷态（单数 filter）build 上实测 FAIL、修复态 PASS，确认对症。
  顺带修掉探针自身的几何缺陷：无头下侧栏是真侧栏、会挤压页面视口，挂件随之移动，
  原先按打开前视口算死的 fab 坐标会落空（打在 body 上被「外点收起」顺手收起面板，
  造成假绿/假红）——所有按钮点击改为按节点盒模型取中心。
- 文档同步：TC-07-8 步骤 6/7 补判据（轮询不翻回、别处打开后初始即已打开）；
  附录 A / TODO / site-ai-offscreen-host 设计文档的挂件探针基线 18 → 20 项。
  测试数不变（403 项 / 32 文件）。

### ⑭ 命令行口令直连形态漏检修复（真机验收发现）

- **`mysql -p'<口令>'` 不再漏检**（漏检实例：`-u lantu_app -p'Qy7#mP2!vL9@'` 原样穿过，
  该段整段唯独这条未被识别）：旧 CLI 口令规则要求旗标后必须有空白（`\s+`），mysql 的
  直连引号形 `-p'…'`/`-p"…"`、直连裸值形 `-p<口令>`、以及 `--password=<口令>` 等号形
  全部不命中。规则重写为三形态并存：分隔形（`-p x` / `-password x` / `--password=x`，
  可引号包裹）、直连引号形、直连裸值形；引号包裹时 span 只锚内层口令本体。
- **直连裸值的精度锚放进正则**：首字符必须字母数字、体不含 `=`、且必含一个非字母数字
  下划线的符号位——`-pretty`/`-P3306`/`-pathfile`（纯字母数字短选项变体）、`-port=8080`
  （等号选项值）、散文 `--passphrase` 全部零误报。开发中修掉一个关键缺陷：符号位判断类
  必须显式排除空白与引号，否则紧随值后的空格会被当成「符号位」，精度锚整体失效。
  取舍：直连裸值为纯字母数字的口令不检出（宁缺勿误，与 ⑫ 的纯字母取舍一致）。
- **span 按组长度精确定位**（替换 `indexOf(value)` 猜位置）：`--password word` 时旧实现
  把 `word` 在旗标内部命中、span 错位进 `--password` 中段。`naturalPasswordRules` 同步
  对成对引号的值内缩一层——否则 `--password="…"` 的散文分支 span 含引号且早 1 位，
  重叠仲裁会赢下 CLI 的精确 span（两规则 span 收敛后由 `deduplicateByPosition` 合并）。
- 单测扩到 **403 项（32 文件）**：新增 `cliPasswordRules.test.ts` 11 项（检出 7 + 精度
  防线 4，覆盖 2026-10-21 真机原文与三形态回归）；evidence 同步 403/85。

### ⑬ 粘贴链路执行「保留」判定 + 挂件侧栏状态推送补全（真机验收发现）

- **粘贴拦截不再无条件全替换**（验收现象：识别项判定为「保留」，粘贴出去仍被脱敏）：
  旧实现两处都直接 `sanitizeText`（replaceAll，忽略档案策略），SW 正则首答还把请求
  携带的档案丢了（`detect(text)` 走默认档）。现把 keep/replace 判定上收到 engine：
  `profiles.ts` 新增 `resolveDefaultAction`（原 store 本地实现迁入，侧栏 / SW /
  offscreen 三链共用），`replacer` 新增 `sanitizeWithProfile(text, items, profile)`——
  SW 正则首答与 AI 二次升级都改走它，邮箱/高熵/IP 等判定为「保留」的项在粘贴改写与
  升级结果中保持原文，与设置页默认策略一致。
- **挂件按钮状态推送补全**（验收现象：侧栏开关状态仍不实时）：⑪ 的推送在
  `onOpened/onClosed` 事件不带 `tabId`（用户从工具栏图标开关**全局侧栏**）时被直接
  丢弃——`pushPanelState` 改为无 tabId 时**广播**到所有标签页（未授权站点没有挂件，
  `sendMessage` reject 静默吞掉，有挂件的授权站点才会更新）。另在 `OPEN_SIDE_PANEL`
  成功后主动推一次开态，打开路径不再依赖 `onOpened` 是否触发。
- 单测扩到 **392 项（31 文件）**：新增 `sanitizeWithProfile.test.ts` 4 项（universal
  档真机场景 keep 生效 / `sanitizeText` 无条件替换对照组 / 显式 `defaultActions` 覆盖 /
  `tierLowConfidence` 分层）；evidence 同步 392/85。

### ⑫ 散文口令与 sk- 厂商段密钥漏检修复（真机验收发现）

- **自然语言口令检出**（漏检实例：`新密码是 Qy7#mP2!vL9@` 原样穿过）：既有口令规则
  全部只锚结构化语法（`KEY=value`/YAML/JSON/CLI/连接串），散文声明一条不命中。新增
  `naturalPasswordRules`：关键词（密码/口令/通行码/password/passwd/pwd/passphrase）
  + 必需连接词（是/为/is/:/：/=）+ ASCII 值域 `[!-~]{4,}`。三层精度防线——连接词必需、
  中文谓词落不进值域（「密码不能为空」不匹配）、值必须含数字或非字母（挡
  `password is required` 纯字母表语），再叠 shouldSkipValue（过短/纯数字/弱口令）。
  类型 `ENV_PASSWORD`（占位符 `<<密码>>`）、high 置信 ⇒ 各档默认替换。
- **sk- 厂商段密钥不再只落高熵**（漏检实例：`sk-live-<hex>` 未替换——OpenAI 规则
  `sk-[alnum]` 被中间的 `-live-` 整段打断，只剩 HIGH_ENTROPY，而 universal 的
  `HIGH_ENTROPY=keep` 使其原样保留）：新增 `sk-<小写厂商段>-<≥32 位小写十六进制体>`
  规则并置 high（⇒ 默认替换）；精度锚在「体必须是连续纯小写十六进制」，既有
  `sk-an-` 混合大小写 FP 防线用例不破。
- 单测扩到 **388 项（30 文件）**：`naturalPasswordRules.test.ts` 7 项（检出 4 + 精度
  防线 3，含真机原句与「工单里涉及的密码和 API Key 仅用于测试识别」零误报）+ sk-
  厂商段 4 项；`engineBoundaries` 按引擎文件数展开自动 +2。evidence 同步 388/85。

### ⑪ 侧栏开关原生事件实时推送（`onOpened`/`onClosed`）

- **「别处关掉侧栏 → 按钮复位」从轮询压到即时**：⑩ 里关闭靠挂件 2s 轮询发现，
  最坏要等一个周期。现叠加浏览器原生推送——SW 注册 `sidePanel.onOpened`（Chrome 141+）
  与 `onClosed`（142+），事件一到即经 `tabs.sendMessage` 把 `panelOpen` 推给该标签页
  顶层的挂件，按钮立即翻转。轮询保留作兜底：旧浏览器无此事件、以及收起态下
  「宿主仍在收敛」的同步，都仍走原路径。
- **新增消息契约 `SITE_AI_PANEL_STATE`**（`@engine/messages`）：只带 `panelOpen` 一个
  字段的 SW → 挂件单向推送；挂件端新增 `onMessage` 监听，收到即重画。推送不动
  `opening`/`openFailed`——那是本页「打开请求」自己的生命周期，仍由 `OPEN_SIDE_PANEL`
  回包收尾。旧浏览器注册处用特性检测跳过，零副作用。
- `probe:widget` 扩到 **18 项**：新增「推送关闭 → 按钮立即复位为可点」「推送打开 →
  按钮立即置回已打开态」，从扩展上下文按 `tabs.sendMessage` 同款投递驱动。

### ⑩ 挂件交互与站点匹配打磨（子域、按钮态、实时性、间距）

- **站点匹配支持子域**（`@engine/sites`）：裸域名一并覆盖其所有子域——`deepseek.com`
  同样命中 `chat.deepseek.com`；`*.a.com` 与 `a.com` 等价（`*.` 只作书写提示，不入库）。
  授权时把本域与 `*.` 两条 origin 一起申请，否则子域页面匹配得到却没权限注入（IP 与
  带端口的条目没有子域，不申请）；多条命中时路径相同则取主机名更长的那条。
- **「在侧边栏中打开」按钮改为状态控件**（修「点了就失效」）：上一版成功后没人复位
  `disabled`/`cursor`，留下永久灰态 + 转圈光标，看起来像点了没反应或疑似在跑后台任务。
  现在三种态由 `render` 重建——在途 `wait` + 半透明、成功切「侧边栏已打开」禁用态、
  失败就地提示 3s 后复位。
- **按钮状态实时**：SW 用 `runtime.getContexts` 查侧栏真实开关（弹窗兜底按文档 URL 认），
  挂件展开期间每 2s 同步一次，收起即停——在别处关掉侧栏能立刻反映回按钮。
- **「尚未就绪」提示不再误导**（修「模型下载完第一次开页面仍提示未就绪」）：SW 在
  `SITE_AI_GET` 时若「全局开 ∧ 本站开 ∧ 宿主没跑」就预热模型宿主（模型文件早已在本地，
  秒级就绪），挂件轮询自己翻到可用；本站开关开着而宿主还没就绪时文案改说「正在启动」，
  而不是「尚未就绪」。收起态若仍在收敛，放慢到 4s 继续同步到就绪为止。
- **暗色下面板与按钮加边框**（0.18 → 0.3）并加强投影：0.18 在深色页面上几乎看不见，
  面板与背景连成一片。
- **展开后边距与间距放宽**：面板内边距 14 → 16px、头部下边距 8 → 12px、行间距
  10 → 12px、提示上下边距 6/12 → 10/14px、打开按钮内边距 9 → 10px。
- `probe:widget` 扩到 **16 项**：新增「暗色下面板带能与背景区分开的边框」与
  「打开后切成已打开态（禁用且不留转圈光标）」；`sites` 单测扩到 **24 项**（覆盖子域匹配，
  全量 375 项）。

### ⑨ 挂件主题配色 + 站点写法完善（含「打开侧栏」修复）

- 挂件与「已脱敏 N 处」toast 的配色改为**跟随页面明暗主题**（`prefers-color-scheme`，
  与设计 token 同一开关条件）：亮色白底墨字、暗色深底浅字，mark 同步换色。注入侧不能写
  `<style>`（宿主 `style-src` 会拦），色板在 JS 里取值、样式走 CSSOM，切换时整体重绘，
  不用刷新页面。
- 收起按钮由圆形改为 **12px 圆角矩形**（与面板/卡片同规格），mark 略放大（按钮 26px、
  面板头部 20px）；正文字号 13 → 14px、提示 11 → 13px、收起 × 16 → 18px。
- toast 同步调大：13px / 6×12 → **15px / 9×14**，圆角 8 → 10px，并同样跟随主题。
- 修复「在侧边栏中打开」点了没反应：`sidePanel.open()` 只认用户手势，而 SW 此前先
  `await` 授权校验再调用，手势已经过期（实测报 `may only be called in response to a user
  gesture`，页面侧毫无反馈）。现在**同步发车**（授权校验并行进行，只决定回包内容）；
  侧栏 API 不可用（无头/旧版）或手势失效时，同一份面板页面退回 `windows.create` 弹窗；
  真失败时按钮就地提示「打开失败，请点扩展图标」。
- 站点写法完善（`@engine/sites`）：
  - **支持带路径**：`a.com/docs` 命中 `/docs` 及其子页，按目录边界匹配（`/docspage` 不命中）；
    手写的 `a.com/docs/*` 子树写法原样保留；列表条目原样显示，逐站开关的键即该条目。
  - **只写一级路径 / 多级路径都认**，查询与锚点丢弃、结尾斜杠归一。
  - **显式写 http 视为协议不限**：站点从 http 跳到 https 后照样命中；授权时把
    http/https（带路径时再加精确路径 + 子树）两条一起申请，
    `optional_host_permissions` 补上 `http://*/*`（localhost 与 127.0.0.1 不再是唯一例外）。
  - 多条命中取最具体的一条（保证逐站开关键唯一）；SW 授权改为按 `sender.url` 在用户列表里
    解析条目，页面不再上报 pattern（隔离世界内容不可信，带路径的条目页面也算不出来）。
- 侧栏 header 去掉「AI脱敏助手」副标题，只留品牌锁标（`app_subtitle` 文案键一并删除）。
- `probe:widget` 扩到 **14 项**：新增 12px 圆角矩形、亮/暗两套 mark 配色（CDP 模拟
  `prefers-color-scheme`）、以及「点击后侧栏或弹窗面板真的打开了」；`sites` 单测扩到 20 项
  （全量 371 项）。

### ⑧ 页面挂件放大并换上白色 logo

- 收起态圆形按钮 **28 → 44px**（触控目标下限），展开面板 **248 → 280px**、内边距 12 → 14px、
  标题 12 → 13px；按钮里的「AI」字样换成看门狗 mark，面板头部左侧加同款 mark。
- mark 染成白色（挂件底色恒为深色）。取图方式：SW 用 `?raw` 读 `public/icons/logo.svg`
  并换色，随 `args` 传进注入函数，`DOMParser` 落地——不用 `<img src>` / `fetch`，
  既不看宿主页面 `img-src` 的脸色，也不用往 `web_accessible_resources` 加条目。
  换 logo 只改资产一处，工具栏图标与挂件同步。
- `probe:widget` 扩到 **11 项**：新增收起态 44×44，以及穿透 closed Shadow DOM 断言
  两枚 `svg path` 的 `fill === '#fff'`（端到端验证 ?raw → args → 解析 → 染色）。

### ⑦ 品牌图标换新（新 logo 接入插件 / 落地页 / README）

- `public/icons` 清理改名（保留 `logo` / `logo-1` 两名，作者调整过尺寸与边距的最终稿）：
  纯看门狗 → `logo.svg`（400×400）、看门狗 + 字标锁标 → `logo-1.svg`（1414×400）；
  旧盾牌 mark、`public/` 根下未被任何地方引用的 `public/icon.svg`、以及导出过程中的
  临时文件一并删除。两份源 SVG 补上缺失的 `viewBox`
  （否则按 CSS 尺寸放缩时图形不跟随）。
- 新增 `logo-1-dark.svg`（同形、墨色换成暗色主题前景色 #fafafa）。README、站点头、
  侧栏头部统一用 `<picture>` + `prefers-color-scheme` 切换，与设计 token 同一套条件；
  favicon 是独立文件读不到页面变量，沿用自带 `<style>` + media query 的做法。
- 接入：插件 manifest 图标仍由 `npm run icons` 从 `logo.svg` 生成 16/32/48/128；
  侧栏左上与落地页页头换成 `logo-1` 锁标（高 36px，页头原「图标 + 文字」删除）；
  落地页 favicon 改用 `logo.svg` 几何；两份 README 各加入 `logo-1`（宽 260px）。
- 随之失去引用的 `packages/extension/src/ui/Logo.vue` 与 `apps/site/src/components/Mark.astro` 删除。
- 发布包按新图标重打：`release/contextwatchdog-1.0.0-{chrome,firefox}.zip` + `SHA256SUMS`。

## 2026-10-20

### ⑥ 挂件常驻（× = 收起）

- 页面挂件改为常驻：移除 `siteWidgetHidden` 存储键、`SITE_WIDGET_HIDE` 消息与站点删除时的
  相关清理；`×` / `Esc` / 点击面板外都只**收起面板**（`expanded = false`），右下角圆形按钮
  始终保留。旧 profile 里的残留值不再读取，零用户无迁移。
- 常驻加固：`MutationObserver` 在挂载时立即启动，页面清 DOM 后自动重挂；另加 3 秒心跳兜住
  `document.open/write` 与 `documentElement` 被整体替换；`SITE_AI_GET` 瞬时失败不再卸载挂件；
  状态回包前开关一律禁用（含 `ready=false`），避免显示错状态或误点。
- `probe:widget` 新增「页面删除 host → 自动重挂」断言（共 8 项）；TC-07-8 第 5 步改为常驻判据。
- 发布包重打：`release/contextwatchdog-1.0.0-{chrome,firefox}.zip` + `SHA256SUMS`。

### ⑤ S5：收尾（挂件探针 + 宿主销毁 + 文档）

- 新增 `npm run probe:widget`：无头 Chrome 实测授权站点挂件出现、iframe 内不出现、
  未授权站点零注入、不产生横向滚动条、不往 body 塞节点。运行期临时给
  `dist/manifest.json` 加测试站 `host_permissions`，结束后原样恢复；新版正式版 Chrome
  忽略 `--load-extension`，脚本优先使用 Chrome for Testing / Chromium。
- 宿主销毁实测：`MODEL_HOST_CLOSE` 后 offscreen 目标数 1 → 0、`hasDocument=false`、
  `storage.session` 快照清空（模型内存随文档销毁回落到基线）。
- 文档：`spec.md` 改写「拦截为正则档」的已知限制，补 `offscreen` 权限与逐站/宿主 session 键；
  `test-cases.md` 新增 TC-07-8（挂件与逐站开关）、TC-07-9（AI 二次升级）与探针基线；
  `releasing.md` 发布前检查加入 `probe:widget`。
- 发布包按当前代码重打：`release/contextwatchdog-1.0.0-{chrome,firefox}.zip` + `SHA256SUMS`。

### ④ S3：粘贴链路 AI 二次升级（数据面）

正则先落地，AI 只做增量；任何失败都保留正则结果：

- `PASTE_DETECT` 新增可选 `token`；content script 对 input/textarea 在正则结果落地后记录
  `appliedText / range / valueAfterApply / appliedAt` 快照。
- SW 回包之后按 `effectiveAI = 全局 ∧ 本站 ∧ 宿主就绪` 决定是否 `detectViaModelHost(原文)`，
  成功后向原 tab/frame 发 `PASTE_AI_RESULT{ token, sanitized, count }`。
- content script 四道守卫（用户未继续输入 / 正则结果仍在原位 / AI 确有增量 / 8s TTL）
  全过才二次替换并修正光标，toast 改为「AI 增强后共脱敏 N 处」；否则丢弃。
- 守卫的可测版本在 `content/pasteText.ts` 的 `planAiUpgrade()`，注入函数内含等价副本；
  单测覆盖 value-changed / range-moved / no-increment / expired 与三种光标位置。
- contenteditable 本期仍只走正则档；Firefox 无宿主，粘贴 AI 升级不可用
  （侧栏手动检测不受影响）。

实测（Chrome for Testing + 真实模型）：正则先脱敏 3 处，AI 补出姓名后共 4 处，
toast 显示「AI 增强后共脱敏 4 处」。
基线：typecheck 0 / 360 tests（29 文件）/ 双目标构建通过。

### ③ S4：页面挂件与逐站 AI 开关（控制面）

授权站点的右下角新增一个自包含挂件，AI 是否生效由「全局 × 本站」两层开关决定：

- `@engine/settings`：`AI_ENABLED_KEY` / `SITE_AI_ENABLED_KEY` / `SITE_WIDGET_HIDDEN_KEY`
  与 `isEffectiveAI()`（全局 ∧ 本站 ∧ 宿主就绪），键名只此一处。
- `SITE_AI_GET` / `SITE_AI_SET` / `SITE_WIDGET_HIDE` / `OPEN_SIDE_PANEL`：
  SW 侧双校验——`sender.url` 推导的 pattern 必须与请求一致，且在授权列表内；
  页面隔离世界里的消息内容不可信。
- 挂件与粘贴监听共用 `__contextWatchdogInstalled`，只挂顶层文档（`allFrames` 注入但不进 iframe）；
  全内联样式 + Shadow DOM 隔离，`MutationObserver` 在自身被移除时重挂。
- 全局 AI 关闭或宿主未就绪时，开关禁用并显示原因；未授权站点零注入。
- 删除站点时 SW 自动清理 `siteAiEnabled` / `siteWidgetHidden`，重新添加回到默认关闭。

实测（Chrome for Testing）：授权站点顶层出现挂件（fixed / z-index 2147483647）、
iframe 内没有、未授权站点没有、页面无横向滚动条。
基线：typecheck 0 / 352 tests / 双目标构建通过。

### ② S2：侧栏改为模型宿主客户端

Chrome/Edge 下侧栏不再自己加载模型，改为向 SW 请求、订阅宿主状态；Firefox 仍走本地加载：

- `stores/detection.ts`：`initNER()` 先探测宿主能力（`MODEL_HOST_STATUS`），支持则发
  `MODEL_HOST_ENSURE`，进度/就绪/错误全部由 `storage.session['contextwatchdog.modelHost']`
  驱动；`detectText()` 在 AI 就绪时经 `MODEL_HOST_DETECT` 走宿主，失败或未就绪回退本地正则。
- 关闭全局 AI 时发 `MODEL_HOST_CLOSE` 销毁 offscreen 文档，并清掉 session 状态快照。
- SW 的 ENSURE 改为立即回包（首次下载可能数分钟，占着消息通道没有意义）；
  文档/端口起不来时写一条 error 状态，避免面板一直转圈。
- 宿主状态与既有 UI 字段一一映射，组件零改动；60s 停滞超时在宿主路径同样生效。

### 品牌改名：PasteGuard → ContextWatchdog

项目更名为 **ContextWatchdog**（中文描述语：**文本守卫**）。这是发布前的纯身份调整，
不改变任何检测、判定或替换逻辑：

- 包名 `context-watchdog` / `@contextwatchdog/*`；9 个 `chrome.storage` 键前缀改为
  `contextwatchdog.*`（零用户、未发布，不做迁移）。
- 扩展名、描述、侧栏与 offscreen 标题、日志前缀 `[ContextWatchdog]`、图标 `aria-label`、
  发布包名 `contextwatchdog-<version>-<target>.zip`。
- 站点、README、设计文档与品牌政策同步；中文首次出现处标注「文本守卫」。
- gecko id 暂为占位 `contextwatchdog@contextwatchdog.invalid`，AMO 首次上传前替换。

### ① S1：offscreen 模型宿主骨架

Chrome/Edge 下模型运行时移出任何 UI 上下文，放进唯一的 offscreen 文档：

- 新增 `src/offscreen/{index.html,host.ts}`（ENSURE / DETECT / PING）与
  `src/modelHost/{protocol,state,client}.ts`（协议、状态归并纯函数、SW 侧客户端）。
- SW 经 Port `pg-model-host` 路由请求，并用 `chrome.offscreen.hasDocument()` 幂等创建文档；
  `createDocument` 并发冲突时复查后再继续。SW 回收重启后由宿主自动重连。
- `manifest.json` 加 `offscreen` 权限；`vite.config.ts` 加 offscreen HTML 入口
  （**必须在 `rolldownOptions.input`**：Vite 8 下写 `rollupOptions.input` 会被静默丢弃）；
  Firefox 目标不产出该入口，`postbuild.mjs` 同时过滤 `offscreen` 权限。
- 新增 `tests/unit/modelHost.test.ts`（10 例）：状态迁移与端口消息守卫。

两个实测发现（已写进代码注释与设计文档）：

1. **offscreen 文档只暴露 `chrome.runtime`** —— `chrome.storage` / `chrome.i18n` 均为
   `undefined`。所以状态由宿主经 Port 上报、SW 代写 `storage.session`；占位符语言改用
   `navigator.language`。原设计里「宿主自己写 session」是错的。
2. **构建体积没有翻倍**：offscreen 入口 chunk 2.2KB，ORT / transformers / gliner 与侧栏
   共用同一批 chunk，`dist` 仍为 12MB。原计划的 `manualChunks` 不需要。

验收（Chrome for Testing 151 + `--load-extension dist`；品牌版 Chrome 137+ 已忽略该参数）：
文档创建 → 模型加载（进度经 SW 写入 session）→ DETECT 回包含正则与模型双来源 items
→ `closeDocument` 后 `hasDocument()` 为 false。Firefox 构建无 offscreen 入口与权限。

### 站点部署身份改走 `.env`（域名 / 商店链接 / 备案 / 收款码）

源码是公开的，而上面这些值描述的是**这一份部署**。放在仓库里，别人 fork 之后会
静默继承：canonical 指向作者的站、下载按钮导向作者的商店页、页脚挂着别人的备案号
（等于冒用备案）、打赏二维码把访客的钱导向作者账户。

- 新增 `apps/site/.env.example`（全量键名与降级行为）与 `scripts/lib/site-links.mjs`
  （`resolveSiteLinks` / `parseHttpsBase` / `normalizeRepository` / `channelStates`，
  纯函数 + 12 例单测）。`astro.config.mjs` 在配置阶段读 env 并通过 `vite.define`
  注入 `__SITE_LINKS__`，页面里拿到的仍是构建期常量（prerender chunk 里可安全使用）。
- **删掉 `apps/site/src/data/links.json`**：`available` 不再手写布尔值，改由「URL 是否为空」
  派生——状态与链接在类型上不可能再对不上。
- 仓库与 Release 的链接改由 `package.json#repository` 派生（一个字段驱动源码 / Release /
  Issues 与扩展 `manifest.homepage_url` 的后续接入），fork 改一处即可。
- 中文页的「阅读源码」与「下载」按语言指向镜像（`GITEE_URL`，为空回退 GitHub）；
  深度链接（LICENSE / NOTICE / PATENTS / docs）与 Issues 固定指 GitHub——镜像的默认
  分支名不保证是 `main`，写死路径会 404。
- `check:versions` 不再读 JSON，改为「env 合法性 + 产物自洽」两段：逐页核对 canonical
  路径，并核对产物里的域名与当前 `SITE_URL` 一致（改了 env 忘了重建会被抓住）；
  `--release` 要求 `SITE_URL` 已配、至少一个商店渠道已配。
- 缺 `SITE_URL` 时普通构建只警告（fork 仍可构建出相对链接的产物），发布构建用
  `SITE_REQUIRE_URL=1` 直接失败——避免静默产出一份没有 canonical 的线上站点。
- 部署相关（nginx / 证书 / 上传）明确排除在仓库之外；文档只保留「构建命令 / 产物路径 /
  需要哪些 env」。
- 页脚新增备案行（`ICP_BEIAN` / `POLICE_BEIAN`，留空则不渲染）。国内托管站点的法定义务，
  同时也不能被 fork 继承——冒用备案是法律问题。
- 打赏收款码：`DONATE_QR` 指向本地图片，构建期读成 data URI 内联（图片不进仓库、
  站点保持零外部请求）；固定白底，避免深色主题下二维码扫不出来；缺省仍是占位文案。
- `CONTRIBUTING.md` 的 fork 做法补上第 5 步「填自己的部署身份」与留空降级表。

### 发布标签改为 `<version>-<target>`

- tag 形态从 `ext-v1.0.0` / `site-v1.0.0` 改为 `1.0.0-ext` / `1.0.0-site`（本地应用用 `-app`）。
  不用 `v` 前缀（它不增加任何信息）；`ext` / `site` / `app` 是**发布产物**的边界，不是渠道边界
  —— 一个 `-ext` Release 同时挂 Chrome 与 Firefox 两个包，所以不叫 `-crx`。
- 规则与查重抽为 `scripts/lib/version-tag.mjs`（`formatVersionTag` / `parseVersionTag` /
  `tagsForVersion` / `tagMatchesVersion`），`check-versions` 改为一次查三个 tag 是否占用；
  新增 `tests/unit/versionTag.test.ts`，其中「旧形态必须认不出来」是反向断言——改名时漏改
  一处，`check-versions` 会以为标签没被占用，这条会先红。
- 版本核心限定三段数字：预发布号（`1.0.0-rc.1`）会与 target 后缀抢 semver 的 pre-release 段，
  排序语义不可预期，因此直接禁止；要发预发布就把版本写进主体。
- 两个已知副作用已写进 `docs/releasing.md`：GitHub 会把 `1.0.0-ext` 自动判为 pre-release
  （建 Release 时手动取消勾选），同时保持「Set as the latest release」勾选
  （`{repo}/releases/latest` 依赖它）。

## 2026-10-19

### 1.0.0 发布前 · 验收体验修正

作者按 A–F 产物做了一轮手工验收，以下是随后的修正（同属 1.0.0，未改变任何行为契约）：

- **界面（侧栏）**
  - 「界面语言」移到设置面板**首位**（原在引擎开关之后），边距与其它区块同构
    （`px-4 pt-4`，`pb=0`，由下一块的 `pt-4` 合成 16px 间距）；面板标题随之从
    「检测引擎状态」改为「设置」——它早已不止装引擎开关（还有语言与粘贴拦截）。
  - **修**：切语言后「模式」名称不更新。根因是 reka-ui 的 `SelectValue` 显示的是
    候选项**挂载时**抓取的 `textContent` 快照（`SelectItemText` 挂到游离
    `DocumentFragment` 里采集），不随语言变化。改为直接渲染响应式的 `profileLabel()`。
  - **修**：长文本检测时遮罩不上屏 / spin 卡死。根因是 `waitForPaint` 用 rAF 当
    「已绘制」的证据，而 rAF 回调发生在**绘制之前**——遮罩的 DOM 更新与检测的同步长任务
    落在同一任务里，那一帧的绘制被整段跳过。改为 rAF 之后再让出一个宏任务（渲染步骤
    恰在其间），并给遮罩与按钮 spinner 加 `will-change-transform` 提升为合成层，
    主线程被占时动画仍由合成器驱动。时序屏障抽为 `lib/paintBarrier.ts` 并加**顺序单测**
    （改回旧写法会立刻变红；`probe:layout` 那条 rAF 断言对这类退化是假阴性，注释已注明）。
  - **修**：自定义档案的「检测类别」勾选项被压窄 → 改流式换行（词条长度差异很大，
    单行 flex 会把「美国区域规则（社保号 / 税号 / 电话）」挤成窄块）。
  - **修**：切语言后底部三个操作按钮换行、按钮栏高度跳动 → 改为单行不换行 + 省略号
    （省略号需要一层包裹元素，`Button` 的 slot 是裸文本节点）。
  - **修**：语言下拉框的聚焦态与其它输入框不一致（用了 `ring-2` 且不透明边框，而
    `Input`/`textarea` 是 `ring-1` + 聚焦时边框透明）→ 统一为后者的写法。
    自定义档案编辑器里的两个 `<select>` 是同一个毛病，一并改掉。
- **落地页**
  - 删除「几处设计取舍」整块与对应导航项（叙事上冗余）。
  - 删除安装区「渠道仍在审核中…」与「同一份源码构建…sha256」两段说明——前者把
    「介绍页」写成了「等待中的状态」，后者与「可核验的隐私承诺」重复。
  - 「下载」改「安装」；四个渠道由单列长条改为**矩形卡片一行**（`auto-fit`，宽屏四并排）。
  - hero 去掉安装按钮，只留「阅读源码」；安装区去掉引导句（「三个商店渠道之外…」）
    与每个渠道的说明文字——手动安装步骤在 GitHub Release 页上有，页面上抄一遍既长
    又不保证同步，卡片只留「名称 + 状态/跳转标记」并保持 flex-col。
  - 隐私承诺六条说明的文案长度对齐（zh 74–88 / en 147–163 字符，误差 ≤1 行），
    使卡片高度一致；`pg-channel-hint` 规则随说明文字一并删除。
- **权限收窄**：`optional_host_permissions` 去掉宽泛的 `http://*/*`，保留
  `https://*/*` + `http://localhost/*` + `http://127.0.0.1/*`（本地调试用）。
  明文 http 站点不再可授权，减少商店审核摩擦。
- **清理**：删除未使用的 devDeps（`autoprefixer` / `postcss`——Tailwind 4 走
  `@tailwindcss/vite` 内置 Lightning CSS，`postcss` 仍作为 vite 传递依赖存在）；
  文档里的测试基线数字同步（含 `docs/spec.md` / `docs/test-cases.md`）。
- **基线**：typecheck 0 error / **311 passed（25 文件）** / 双目标构建零警告 /
  `probe:layout` 全通过 / 站点 0 诊断、4 页 0 JS。

### 1.0.0 发布准备 A–F · 关键节点结案

本轮完成 A–D（A–F 六个关键节点）：

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
  （本节点结案时的基线；随后「验收体验修正」一轮把用例补到 311 passed / 25 文件）
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
- **验证**：TC-06-9 实测通过（含节流盲区复核：清 `contextwatchdog.lastModelProbe` 后探测真实执行、
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
