# PasteGuard 待办与状态

> 当前架构：`README.md`（快速开始）+ `docs/spec.md`（技术说明）。
> 手动验收判据：`docs/test-cases.md`；实现轮次与结案沿革：`CHANGELOG.md`。

## 当前状态（2026-10-19）

- **1.0.0 发布准备进行中**（A–F 关键节点，见 `docs/design/roadmap.md`）：A 许可与文档、
  B/C 目录重排与 `InferenceBackend` 抽象、D i18n + 区域规则集 + 能力矩阵已完成；
  E Astro 落地页、F 发布待做。
- **功能全部实现、验收全绿**：侧栏手动脱敏（正则恒开 + AI 级联可选）、
  自定义档案/正则/白名单与 JSON 导入导出、粘贴自动拦截（逐站授权，含 contenteditable
  富文本与「已脱敏 N 处」轻提示）、GLiNER 推理链路（wasm/模型全本地、断网可用、
  形状门禁拦截幻觉）、Chrome/Firefox 双目标构建、明暗主题、中英双语界面。
- **校验基线**：`npm run typecheck` 0 错误 / `npm test` **288 passed（22 文件）** /
  `npm run build` + `npm run build:firefox` 通过 / `npm run probe:layout` 全通过。

## 回归命令

```bash
npm run typecheck && npm test && npm run build && npm run build:firefox && npm run probe:layout
# 期望：0 error / 288 passed / 双目标构建通过 / 布局探针全通过
```

## 待办

- [ ] **H-1 输入区去自动检测**（`f81ced0`）：粘贴与手动输入均不再自动检测，仅「检测」按钮
  触发；检测后继续编辑旧结果保留（「清空」一并清）。→ **TC-02-1**（含负向判据）
- 暂无其他。新候选在此登记（挂 `docs/test-cases.md` TC 编号）；实现 + 实机验收闭环后
  移入 `CHANGELOG.md` 对应轮次并清空本清单。
