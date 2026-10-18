# PasteGuard 待办与状态

> 当前架构：`README.md`（快速开始）+ `docs/spec.md`（技术说明）。
> 手动验收判据：`docs/test-cases.md`；实现轮次与结案沿革：`CHANGELOG.md`。

## 当前状态（2026-10-18）

- **功能全部实现、验收全绿、无遗留待办**：侧栏手动脱敏（正则恒开 + AI 级联可选）、
  自定义档案/正则/白名单与 JSON 导入导出、粘贴自动拦截（逐站授权，含 contenteditable
  富文本与「已脱敏 N 处」轻提示）、GLiNER 推理链路（wasm/模型全本地、断网可用、
  形状门禁拦截幻觉）、Chrome/Firefox 双目标构建、明暗主题。
- **校验基线**：`npm run typecheck` 0 错误 / `npm test` **190 passed（19 文件）** /
  `npm run build` + `npm run build:firefox` 通过（产物 ~12.1MB）。

## 回归命令

```bash
npm run typecheck && npm test && npm run build && npm run build:firefox
# 期望：0 error / 190 passed / 双目标构建通过
```

## 待办

- 暂无。新候选在此登记（挂 `docs/test-cases.md` TC 编号）；实现 + 实机验收闭环后
  移入 `CHANGELOG.md` 对应轮次并清空本清单。
