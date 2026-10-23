# ContextWatchdog 待办与状态

> 当前架构：`README.md`（快速开始）+ `docs/spec.md`（技术说明）。
> 手动验收入口：`docs/test-cases.md`（样例与 TC 目录）；实现轮次与结案沿革：`CHANGELOG.md`。

## 当前状态（2026-10-23）

- **1.0.0 功能全部实现、真机验收结案**：侧栏手动脱敏（正则恒开 + AI 级联可选）、
  自定义档案/正则/白名单与 JSON 导入导出、粘贴自动拦截（逐站授权 +「已脱敏 N 处」轻提示）、
  GLiNER 推理链路（wasm/模型全本地、断网可用、形状门禁拦截幻觉）、第①条线授权站点
  AI 增强（offscreen 宿主 + 站点挂件 + 粘贴 AI 二次升级；Firefox 无宿主按设计诚实降级）、
  Chrome/Firefox 双目标构建、明暗主题、中英双语界面与落地页。
  验收结案与各轮沿革见 `CHANGELOG.md` ⑯–㉖。
- **AI 模型已换用多语言版**（`onnx-community/gliner_multi-v2.1`，修复中文召回为零，
  ㉖）：换模后中文召回**真机复验未结**——复验判据 = TC-06-5 / TC-07-9，
  不过则回退换模并诚实化 FAQ（作者侧清单自存仓外）。
- **校验基线**：`npm run typecheck` 0 错误 / `npm test` **420 passed（33 文件）** /
  `npm run build` + `npm run build:firefox` 通过 / `npm run probe:layout` 全通过 /
  `npm run probe:widget` 全通过（20 项）/ `npm run site:check` 0 诊断 /
  `npm run site:build` 通过 / `npm run check:versions` 通过（2 项预期警告：SITE_URL 与渠道未配置）。

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
