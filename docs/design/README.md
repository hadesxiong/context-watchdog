# 设计文档

本目录是 ContextWatchdog 的设计文档。**它们与实现代码一并公开，这是有意的。**

`PATENTS.md` 声明本项目不申请任何专利，全部设计以公开形式发布、构成可实施的现有技术
（prior art）。防御性公开要真正生效，前提是公开的内容**可实施**——本领域技术人员能照着
实现出来。只公开想法、不公开细节，防御效果会大打折扣。因此这里的取舍是：文档写得越细
越有利，且必须与代码同时在仓库里。

> 依据与推理见 [`license-patent-and-brand.md`](license-patent-and-brand.md) 第 4 节。

| 文档 | 内容 |
|------|------|
| [`roadmap.md`](roadmap.md) | 1.0.0 发布路线图（A–F 关键节点与硬依赖顺序） |
| [`release-1.0.0-plan.md`](release-1.0.0-plan.md) | 1.0.0 的发布细节：i18n 三轴、区域规则集、落地页、商店渠道、验收判据 |
| [`license-patent-and-brand.md`](license-patent-and-brand.md) | 许可选型（为何是 Apache-2.0）、专利策略、商标与品牌政策 |
| [`site-ai-offscreen-host.md`](site-ai-offscreen-host.md) | **后续线 ①**：授权站点的 AI 增强（页面挂件控制面 + offscreen 单一模型宿主） |
| [`local-sanitize-proxy.md`](local-sanitize-proxy.md) | **后续线 ②**：本地脱敏代理服务（拦截出网请求 + 白名单 + 溯源审计） |

技术规格与验收判据不在这里：见 [`../spec.md`](../spec.md)（实现说明）与
[`../test-cases.md`](../test-cases.md)（手动验收用例）。实现轮次沿革见
[`../../CHANGELOG.md`](../../CHANGELOG.md)。

## 关于「未实现」的文档

`site-ai-offscreen-host.md` 与 `local-sanitize-proxy.md` 描述的是 1.0.0 **之后**的两条线，
目前只有设计、没有实现。把它们现在就公开，正是上面所说的防御性公开策略的一部分——
代码与文档要一起构成现有技术，等到实现完再公开会留下空窗期。
