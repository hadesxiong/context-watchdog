# ContextWatchdog 待办与状态

> 当前架构：`README.md`（快速开始）+ `docs/spec.md`（技术说明）。
> 手动验收判据：`docs/test-cases.md`；实现轮次与结案沿革：`CHANGELOG.md`。

## 当前状态（2026-10-20）

- **1.0.0 发布准备：代码侧已完成**（A–F 关键节点，见 `docs/design/roadmap.md`）：
  A 许可与文档、B/C 目录重排与 `InferenceBackend` 抽象、D i18n + 区域规则集 + 能力矩阵、
  E Astro 落地页、F 发布就绪（`check:versions` / `pack-release` / `docs/releasing.md`）
  均已落地。**剩三件只能由作者做的事**：
  1. **F8 打 tag**（`1.0.0-ext` / `1.0.0-site`）——`npm run check:versions -- --release` 会先列出还差什么
  2. **F7 互链**：把落地页域名填进 `apps/site/.env` 的 `SITE_URL`，渠道上架后填对应的 `*_URL`（模板见 `apps/site/.env.example`）
  3. **素材**：演示 GIF、打赏收款码、商店截图与 promo tile（清单见 `docs/releasing.md` §6）
- **1.0.0 之后第①条线（授权站点 AI 增强）：S1–S2 已完成**
  （`docs/design/site-ai-offscreen-host.md` §9）：
  offscreen 文档持有唯一一份模型运行时，SW 经 Port 路由 ENSURE / DETECT；
  Chrome/Edge 有宿主，Firefox 构建不产出该入口也不带 `offscreen` 权限。
  已实测：文档创建 → 模型加载 → DETECT 回包（正则 + 模型双来源 items）→ 销毁。
  **S2 已落地**：Chrome/Edge 侧栏改为宿主客户端（状态订阅 `storage.session`，
  检测经 `MODEL_HOST_DETECT`），Firefox 仍走 `LocalHost`；关闭全局 AI 会销毁 offscreen 文档。
  **S3（粘贴链路 AI 二次升级）尚未开始**。
- **功能全部实现、验收全绿**：侧栏手动脱敏（正则恒开 + AI 级联可选）、
  自定义档案/正则/白名单与 JSON 导入导出、粘贴自动拦截（逐站授权，含 contenteditable
  富文本与「已脱敏 N 处」轻提示）、GLiNER 推理链路（wasm/模型全本地、断网可用、
  形状门禁拦截幻觉）、Chrome/Firefox 双目标构建、明暗主题、中英双语界面、双语落地页与隐私权政策页。
- **校验基线**：`npm run typecheck` 0 错误 / `npm test` **342 passed（28 文件）** /
  `npm run build` + `npm run build:firefox` 通过 / `npm run probe:layout` 全通过 /
  `npm run site:check` 0 诊断 / `npm run site:build` 通过 / `npm run check:versions` 通过（2 项预期警告：SITE_URL 与渠道未配置）。

## 回归命令

```bash
npm run typecheck && npm test && npm run build && npm run build:firefox && npm run probe:layout
npm run site:check && npm run site:build && npm run check:versions
# 期望：0 error / 342 passed / 双目标构建通过 / 布局探针全通过 / 站点 0 诊断且构建通过 /
#       check:versions 通过（SITE_URL 与渠道未配置时为 2 项警告）
```

## 待办

- [ ] **H-1 输入区去自动检测**（`f81ced0`）：粘贴与手动输入均不再自动检测，仅「检测」按钮
  触发；检测后继续编辑旧结果保留（「清空」一并清）。→ **TC-02-1**（含负向判据）
- [ ] **H-2 落地页安装区改版 + 分割线评估**（`f9b5133` + `86c9dd1`）：四并列渠道卡片 →
  VS Code/GitHub 式下载按钮 + details 下拉面板（零 JS）——插件组含 Chrome/Edge/Firefox
  与 GitHub 源码（Release 页实链），应用组 Windows/macOS 未上架占位「即将上架」（无死链）；
  组内渠道行改 ghost 式；分割线评估结论=保留每节 1px 单色细线，删 `:first-of-type` 死规则。
  → 双语目视验收（`/` 与 `/en/`：按钮开合、caret 旋转、面板行 hover、窄屏无横向溢出）
- 暂无其他。新候选在此登记（挂 `docs/test-cases.md` TC 编号）；实现 + 实机验收闭环后
  移入 `CHANGELOG.md` 对应轮次并清空本清单。
