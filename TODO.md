# PasteGuard 待办与状态

> 本文档已于 2026-10-18 收尾收敛：原「检测引擎重构计划」（Phase 1-5、§1-§15 历史规划，引用的
> valueExtractor.ts / MobileBERT 场景模型 / 50MB GLiNER 等均已过时或文件已删）整段清退，
> 历史原文见 git 历史（本文件在 `f35ceae` 之前的版本）。
> 当前架构与规格：`README.md`（快速开始）+ `docs/spec.md`（技术说明）。
> 手动验收：`docs/test-cases.md`（本文档所有待实机项均挂对应 TC 编号）。

## 当前状态摘要（2026-10-18）

- **功能全部实现**：侧栏手动脱敏（正则恒开 + AI 级联可选）、自定义档案/正则/白名单、
  档案 JSON 导入导出、粘贴自动拦截（逐站授权）、Chrome/Firefox 双目标构建、明暗主题。
- **校验基线**：`npm run typecheck` 0 错误 / `npm test` **169 passed（18 文件）** /
  `npm run build` + `npm run build:firefox` 通过。
- **实现轮次登记**（代码侧均已完成，证据 = 提交 + 单测/构建）：
  - Phase 1-5 检测引擎重构与规则解耦（历史，见 git）
  - 遗留项 A 组（模型下载健壮性）/ B 组（代码卫生）/ C 组（粘贴拦截、CSP、双目标）：2026-10-17 完成
  - D 组 UX 实测反馈轮（5 commits：`6df1167`…`eb5b0da`）：2026-10-17 完成
  - E 组 UI 收尾轮（7 commits：`0d7a9b2`…`f35ceae`）：2026-10-18 完成
  - AI 推理链路实机修复轮（`e157024` modelType / `aee9dfd` maxWidth / `44c4dd5` 形状门禁 /
    `93d229b` wasm 资产本地化）：2026-10-18 完成，TC-06-5 已实测通过
- **勾选标准**：代码实现 + 三类证据至少其一（静态核对 / 单测 / 实测）→ 代码侧打勾；
  必须真机运行才能判定的保持 `[ ]`，见下方清单。
- 本地未推送提交 15 条（`origin/main = f35ceae`），待实机验证通过后推送。

## 待实机验证清单（代码完成，逐项对应 docs/test-cases.md）

> 实机方式：`npm run build` → Chrome 扩展页重新加载 `dist/`（不要用 `npm run dev`）；
> Firefox 用 `npm run build:firefox` → `about:debugging` 加载 `dist-firefox/manifest.json`。

- [ ] **D-1 缓存命中全程静默**（`6df1167`）：启用 AI 后重开面板不应出现任何下载提示
      （含原「先闪首次需下载 180MB 再变已命中缓存」的误导窗口）；真首次下载仍有进度与「已就绪」。
      → **TC-06-2 / TC-06-3**
- [ ] **D-2 档案下拉**（`f676c97` + `0d7a9b2` 齿轮 bug 修复）：下拉尺寸协调、说明单行省略号、
      齿轮点击进入编辑页、新建/删除流程正常。→ **TC-04-1 / TC-04-2**
- [ ] **D-3 正则恒开 + 场景并入 AI**（`10a9a05`）：正则开关可见但点不动、场景卡已消失、
      AI 开关照常工作且持久化。→ **TC-06-1**
- [ ] **D-4 弹窗标题 + 边框**（`e4c1dfc`）：标题层次清晰、非悬浮状态边框可辨
      （过深/过浅再微调一档）。→ **TC-08-1**
- [ ] **E 组 UI 收尾轮整体复验**（`9101be0`…`f35ceae`）：设置弹窗三段结构（标题固定/正文滚动/
      底部 sticky，分隔线通宽）、底部一行四按钮（导出/导入/删除/保存，字号同预设按钮）、
      默认策略 Switch、引擎面板区块全宽贴边 16px、描述 2 行省略、齿轮入口、
      拦截输入/添加按钮等高、输入焦点统一细 ring、新标签页按钮已隐藏。
      → **TC-04-3 / TC-07-2 / TC-08-1 ~ TC-08-5**
- [ ] **B-5 Switch 深色观感**（把手 `bg-background`）：深色主题下开关把手可辨。→ **TC-08-2**
- [ ] **C-4 新权限体验**：扩展更新后 Chrome 权限提示观感；粘贴拦截站点授权弹窗文案。
      → **TC-01-2 / TC-07-1**
- [x] **B-就绪路径推理**（2026-10-18 三轮修复，**TC-06-5 已实测通过**）：① `modelType` 改
      `'span-level'`（`e157024`）② `maxWidth` 改 12（`aee9dfd`，导出把宽度常量烘焙死 12）
      ③ 中文单字幻觉替换（`户`→姓名、`订`→邮箱）由形状门禁拦截（`44c4dd5`，
      `entityShape.ts`）——用户实测「替换结果符合预期」：除 `<<手机号>>` 外无占位符、
      `Dropped N implausible model entities` 日志出现；姓名/地址检出为加分软预期
      （spec §13-4）。→ **TC-06-5**
- [ ] **A-4 heap 数值回填**：JS 堆快照日志实测峰值，回填至 `docs/spec.md` §14。→ **TC-06-4**
- [ ] **离线推理复验（wasm 本地化）**（2026-10-18 运行时收敛：`wasmPaths` 空对象走
      打包内资产 + webgpu/webgl 打桩剔除 21.3MB jsep + 移除 `@huggingface/transformers`，
      产物 ~34MB → ~12MB）：断网下 AI 就绪、推理照常可用，Network 无 `cdn.jsdelivr`
      请求。→ **TC-06-8**
- [x] **样例 A 行 1 顶格复核**（2026-10-18 已结案）：顶格重贴后控制台实测
      `Found ENV_PASSWORD: DB_PASSWORD = Tr0ub4dor!#2024`、检出 1 条——确认漏检系
      复制带前导空白（env 规则 `^` 锚点失配），非缺陷。→ **TC-02-1**

## 后续候选（未排期，均已拍板暂缓或待设计）

- [ ] 移除 manifest 中未使用的 `contextMenus` 权限声明（本轮盘点发现：全 src 无引用，历史遗留）
- [ ] 粘贴拦截支持 `contenteditable` 富文本区域（当前仅 `input[type=text/search]` 与 `textarea`）
- [ ] 粘贴自动拦截生效时显示「已脱敏 N 处」轻提示（当前完全静默）
- [ ] 短密钥规则（需先定阈值策略，避免高误报；2026-10-17 拍板暂缓）

## 回归命令

```bash
npm run typecheck && npm test && npm run build && npm run build:firefox
# 期望：0 error / 169 passed / 双目标构建通过
```
