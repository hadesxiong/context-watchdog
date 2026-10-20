# 贡献指南 / Contributing

## 本项目由作者单人维护

> **本项目不接收代码合并请求（Pull Request）。**

这是有意为之的维护策略，不是对社区的拒绝：单人维护能保持设计一致性、降低协调成本，也让许可始终可单方面调整。提前写清楚，是为了避免他人投入精力写 PR 却无法合入。

**欢迎**：提 Issue 报告问题、反馈误报/漏报、提出想法与设计讨论、分享使用场景。

---

## 欢迎 Fork

本项目以 [Apache License, Version 2.0](LICENSE) 发布，任何人都可以：

- 复制、使用、修改、再分发；
- 基于本项目开发**闭源或商业化的衍生作品**；
- 自行调整、按自己的需求长期维护。

如果你打算改造后发布，请遵守以下要求。

### 必须做到

| # | 要求 | 依据 |
|---|---|---|
| 1 | 保留仓库中的 `LICENSE`（Apache-2.0 全文） | Apache-2.0 §4(a) |
| 2 | 保留 `NOTICE` 中的署名与商标保留声明 | Apache-2.0 §4(d) |
| 3 | **改动过的文件必须显著标注"你修改过这些文件"** | Apache-2.0 §4(b) |
| 4 | 使用**你自己的名称、标识与图标** | Apache-2.0 §6 |
| 5 | 不得使用 `ContextWatchdog` 名称或图标，不得暗示获得原作者背书 | 商标保留 |

### 为什么 fork 必须改名

`ContextWatchdog` 名称与图标属于作者的商标，**不在 Apache-2.0 的授权范围内**（该许可第 6 条明确排除商标授权，只保留"描述来源"的合理使用）。

因此：

- ✅ 事实性引用，例如：`Based on ContextWatchdog (https://github.com/hadesxiong/context-watchdog)`；
- ❌ 把 `ContextWatchdog` 用作你的衍生作品名称、图标或包名；
- ❌ 暗示你的作品是原项目官方版本或获得原作者背书。

### 建议的 fork 做法

```bash
# fork 后第一步：改名，避免与原项目混淆
# 1. 改 package.json 的 name / author / repository
#    ↳ repository 会驱动落地页的源码 / Release / Issues 链接，以及扩展的 homepage_url
# 2. 改 manifest.json 的 name / description
# 3. 换掉 icons/ 下的全部图标
# 4. 在 README 顶部说明与原项目的关系与分叉点
# 5. 复制 apps/site/.env.example 为 apps/site/.env，填你自己的部署身份
```

第 5 步是这次专门拆分出来的：落地页的**部署身份**不在源码里，包括站点域名、三个商店
地址、Gitee 镜像、备案号、打赏收款码。不填有明确的降级行为，**不会继承别人的**：

| 键 | 留空时 |
|---|---|
| `SITE_URL` | canonical 输出相对路径（不影响本地构建，线上必须先填） |
| `EDGE_URL` 等渠道 | 该行显示「即将上架」，不渲染链接 |
| `ICP_BEIAN` | 页脚不渲染备案行 |
| `DONATE_QR` | 显示「收款码待补充」占位 |

唯一**不会**自动失效的是 `LICENSE` / `NOTICE` 里的原作者署名——那是 Apache-2.0 要求
保留的，不是配置项。

---

## 关于代码归属与专利

- 本项目**不申请专利**，全部设计文档与实现均为公开的现有技术，详见 [PATENTS.md](PATENTS.md)。
- 由于本项目不接收外部贡献，因此**不需要 CLA（贡献者许可协议）或 DCO（开发者原创证书）**——不存在需要梳理权属链的第三方代码。
- 你的 fork、你的改造、你的商业化，权利完全归你。

---

## 开发

```bash
npm install
npm run dev             # 开发服务器
npm test                # 测试套件
npm run typecheck       # 类型检查
npm run build           # Chrome 包 → dist/
npm run build:firefox   # Firefox 包 → dist-firefox/
npm run probe:layout    # 布局探针
```

提交前请确保以下基线全部通过：

```
npm run typecheck          # 0 error
npx vitest run             # 全绿
npm run build              # 零警告
npm run build:firefox      # 通过
npm run probe:layout       # 全绿
```

---

## 行为准则

就事论事，尊重他人。本项目不接受任何形式的骚扰或歧视性言论。

---

## Security

请不要在公开 Issue 中披露安全漏洞，详见 [SECURITY.md](SECURITY.md)。
