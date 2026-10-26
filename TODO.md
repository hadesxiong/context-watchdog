# ContextWatchdog 待办与状态

> 架构：`README.md`（快速开始）+ `docs/spec.md`（技术说明）；验收入口：`docs/test-cases.md`（样例与 TC 目录）；轮次沿革：`CHANGELOG.md`。

## 当前状态（2026-10-23）

- **1.0.0 功能全部实现、真机验收结案**：侧栏手动脱敏（正则恒开 + AI 级联可选）、自定义档案/正则/白名单与 JSON 导入导出、粘贴自动拦截（逐站授权 + 轻提示）、GLiNER 推理全本地且断网可用（形状门禁拦截幻觉）、授权站点 AI 增强（Firefox 无宿主按设计降级）、Chrome/Firefox 双目标构建、明暗主题与中英双语；各轮沿革见 `CHANGELOG.md` ⑯–㉖。
- **AI 模型 `gliner_small-v2`（1.0.0 终态）**：多语言版无浏览器级可用字节、已回退；中文限制已如实声明，AI 档对中文占优片段由 `languageGuard.ts` 整段跳过（判据 TC-06-5）；中文 AI 召回转 **1.1 路线**（本机 torch 重量化 + GitHub Release 托管，见 CHANGELOG ㉖–㉚、spec §13-3/§13-4）。
- **校验基线**：`npm run typecheck` 0 错误 / `npm test` **436 passed（33 文件）** / `npm run build` + `npm run build:firefox` 通过 /
  `npm run probe:layout` 与 `npm run probe:widget` 全通过（20 项）/ `npm run site:check` 0 诊断 / `npm run site:build` 通过 /
  `npm run check:versions` 通过（2 项预期警告：SITE_URL 与渠道未配置）。

## 回归命令

```bash
npm run typecheck && npm test && npm run build && npm run build:firefox && npm run probe:layout && npm run probe:widget
npm run site:check && npm run site:build && npm run check:versions
# 期望：0 error / 436 passed / 双目标构建通过 / 布局与挂件探针全通过 / 站点 0 诊断且构建通过 / check:versions 通过（SITE_URL 与渠道未配置时为 2 项警告）
# Windows：probe:widget 需 CHROME_PATH 指向 Chromium / Chrome for Testing（示例见 scripts/probe-widget.mjs 头注）
```

## 待办

- 暂无。新候选在此登记（挂 `docs/test-cases.md` TC 编号）；实现 + 实机验收闭环后移入 `CHANGELOG.md` 对应轮次并清空本清单。
