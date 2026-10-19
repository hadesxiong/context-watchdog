# @pasteguard/engine

PasteGuard 的检测与替换引擎。**纯 TypeScript，宿主无关**——同一份代码服务三个宿主：

| 宿主 | 用途 |
|------|------|
| 扩展（Chrome service worker / 侧栏） | 浏览器内正则 + AI 级联检测 |
| 扩展 offscreen / 侧栏（Firefox） | GLiNER 模型宿主（见后续迭代） |
| Node（本地脱敏代理） | CLI / IDE / agent 出网前拦截（见后续迭代） |

## 硬约束（护栏，有自动化断言）

本目录**禁止**：

- 静态 `import` 下列包：
  - `gliner`、`@xenova/transformers`、`onnxruntime-web` —— 模型运行时属于宿主层，必须可替换
  - `vue`、`pinia`、`reka-ui` —— UI 属于宿主层
  - `chrome`、`node:*` —— 宿主 API 必须注入适配器
- 直接 `import type` 引用 `packages/extension` 下的任何文件（会产生反向依赖）

**允许**：对 `chrome` 等宿主全局做 `typeof chrome === 'undefined'` 守卫式访问，前提是同时提供可注入的适配器（`createChromeStorage` 这类）。这正是引擎能在 Node 下被 vitest 直接跑起来的原因——`tests/` 里的所有用例都不需要浏览器环境。

## 模型后端

引擎不直接持有模型运行时。检测管线通过 `detector/backend.ts` 的 `InferenceBackend` 接口取得 AI 能力，由各宿主在启动时用 `setInferenceBackend()` 注册自己的实现；未注册时 `getInferenceBackend()` 返回 `null`，管线自动退化为纯正则。

## 目录

```
src/
├── detector/
│   ├── pipeline.ts          # 主管线（级联调度 + 仲裁 + 值传播）
│   ├── backend.ts           # InferenceBackend 抽象 + 单例注入
│   ├── profiles.ts          # Profile 注册表（场景配置）
│   ├── sceneDetector.ts     # 场景启发式（纯规则，无模型）
│   ├── regexRules.ts        # 正则规则编排
│   ├── entityShape.ts       # 实体形状门禁（拦截模型幻觉）
│   ├── userProfiles.ts      # 用户自定义档案（CRUD + sanitize）
│   └── rules/               # 规则模块（按类别分组）
├── replacer/                # 替换引擎（纯函数 apply）
├── sites.ts                 # 受保护站点规范化 / 匹配
├── messages.ts              # 上下文间消息契约
├── types/                   # 类型定义
└── utils/id.ts              # 统一 ID 生成
```

**不在引擎里**：模型的加载、下载、缓存与 GLiNER 调用全部在扩展侧的
`packages/extension/src/model/`。引擎只在检测时问一句 `getInferenceBackend()?.isReady()`
——后端没注册就走纯正则。

**有自动化断言**：`tests/unit/engineBoundaries.test.ts` 会逐个文件扫描 import，
出现 `chrome` / `node:*` / `vue` / `gliner` / `onnxruntime-web` / `@xenova/transformers`
等裸标识符，或相对引用跑出 `packages/engine`，测试直接红。

许可：Apache-2.0，见仓库根 `LICENSE`。
