# ContextWatchdog 待办与状态

> 当前架构：`README.md`（快速开始）+ `docs/spec.md`（技术说明）。
> 手动验收判据：`docs/test-cases.md`；实现轮次与结案沿革：`CHANGELOG.md`。

## 当前状态（2026-10-22）

- **1.0.0 收尾进行中**：真机验收（H-1 输入区去自动检测、H-2 落地页安装区改版、
  TC-07-8/9 站点挂件与粘贴 AI 升级）已全部通过并结案（见 `CHANGELOG.md` 2026-10-22）；
  两个 Firefox 真机缺陷**已修待真机验收**（方案 A 诚实降级：挂件文案按实际形态如实
  显示 + FF 状态查询走 `sidebarAction.isOpen` ∪ 弹窗自追踪，见 `CHANGELOG.md` ⑱；
  判据 = TC-07-8 步骤 6/7 的 **Firefox 分支**）；
  文档整理完成（内部工作文档移出仓库、4 个子 README 并入根 README/CONTRIBUTING/spec/releasing）。
  **剩三件只能由作者做的事**：
  1. **F8 打 tag**（`1.0.0-ext` / `1.0.0-site`）——`npm run check:versions -- --release` 会先列出还差什么
  2. **F7 互链**：把落地页域名填进 `apps/site/.env` 的 `SITE_URL`，渠道上架后填对应的 `*_URL`（模板见 `apps/site/.env.example`）
  3. **素材**：演示 GIF、打赏收款码、商店截图与 promo tile（清单见 `docs/releasing.md` §6）
- **1.0.0 之后第①条线（授权站点 AI 增强）：S1–S4 已完成**
  （`docs/design/site-ai-offscreen-host.md` §9）：
  offscreen 文档持有唯一一份模型运行时，SW 经 Port 路由 ENSURE / DETECT；
  Chrome/Edge 有宿主，Firefox 构建不产出该入口也不带 `offscreen` 权限。
  已实测：文档创建 → 模型加载 → DETECT 回包（正则 + 模型双来源 items）→ 销毁。
  **S2 已落地**：Chrome/Edge 侧栏改为宿主客户端（状态订阅 `storage.session`，
  检测经 `MODEL_HOST_DETECT`），Firefox 仍走 `LocalHost`；关闭全局 AI 会销毁 offscreen 文档。
  **S4 已落地**：授权站点右下角挂件（Shadow DOM + 全内联样式，不影响页面布局），
  逐站 AI 开关经 `SITE_AI_GET/SET` 双校验（`sender.url` + 授权列表）；未授权站点零注入，
  删除站点自动清理逐站配置。**挂件常驻**：× / Esc / 点击面板外只收起，不写隐藏状态；
  页面清 DOM 后自动重挂。
  **S3 已落地**：粘贴链路正则先回包并落地，随后按「全局 ∧ 本站 ∧ 宿主就绪」异步补一次
  AI 检测；四道守卫（未继续输入 / 正则结果仍在原位 / AI 确有增量 / 8s 内）全过才二次替换，
  失败/超时保留正则结果。
  **S5 已收尾**：延迟提示文案、宿主销毁验证（offscreen 目标消失 + `hasDocument=false` +
  session 快照清空）、`npm run probe:widget` 探针、spec/test-cases 文档均已落地；
  TC-07-8/9 真机验收通过（2026-10-21/22，结案见 CHANGELOG）。
- **功能全部实现、验收全绿**：侧栏手动脱敏（正则恒开 + AI 级联可选）、
  自定义档案/正则/白名单与 JSON 导入导出、粘贴自动拦截（逐站授权，含 contenteditable
  富文本与「已脱敏 N 处」轻提示）、GLiNER 推理链路（wasm/模型全本地、断网可用、
  形状门禁拦截幻觉）、Chrome/Firefox 双目标构建、明暗主题、中英双语界面、双语落地页与隐私权政策页。
- **校验基线**：`npm run typecheck` 0 错误 / `npm test` **420 passed（33 文件）** /
  `npm run build` + `npm run build:firefox` 通过 / `npm run probe:layout` 全通过 /
  `npm run probe:widget` 全通过（授权站点挂件 / iframe 不挂 / 未授权零注入 / 删除后重挂 /
  收起态 44×44 / 12px 圆角 / 明暗主题两套配色 / 暗色下面板带边框 /
  打开侧栏按钮切「已打开」态 / 侧栏开/关实时推送使按钮双向即时翻转 /
  轮询一个周期不把「已打开」翻回 / 页面重载后初始即「已打开」禁用态，20 项）/
  `npm run site:check` 0 诊断 / `npm run site:build` 通过 / `npm run check:versions` 通过（2 项预期警告：SITE_URL 与渠道未配置）。

## 回归命令

```bash
npm run typecheck && npm test && npm run build && npm run build:firefox && npm run probe:layout && npm run probe:widget
npm run site:check && npm run site:build && npm run check:versions
# 期望：0 error / 420 passed / 双目标构建通过 / 布局与挂件探针全通过 / 站点 0 诊断且构建通过 /
#       check:versions 通过（SITE_URL 与渠道未配置时为 2 项警告）
# Windows：probe:widget 需 CHROME_PATH 指向 Chromium / Chrome for Testing
#       （正式版 Chrome 与新 Edge 会忽略 --load-extension，示例见 scripts/probe-widget.mjs 头注）
```

## 待办

- 暂无。新候选在此登记（挂 `docs/test-cases.md` TC 编号）；实现 + 实机验收闭环后
  移入 `CHANGELOG.md` 对应轮次并清空本清单。
