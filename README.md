# PasteGuard - AI脱敏助手

PasteGuard 是 Chrome / Firefox 浏览器扩展（Manifest V3），在用户将文本发送给 AI 前，自动检测并替换敏感信息。**双轨检测**：通用文本 PII（手机号/身份证/银行卡/邮箱/车牌/IP）与开发场景密钥（API Key/密码/连接串/JWT/私钥）并重。所有处理在本地完成。

两种用法：

- **侧栏手动脱敏**（默认）：侧栏粘贴 → 检出列表 → 一键脱敏 → 复制
- **粘贴自动拦截**（可选，逐站授权）：在已授权站点粘贴时自动就地替换为占位符，无需打开侧栏

## 快速开始

```bash
npm install
npm run build     # 构建后加载 dist/ 到 chrome://extensions（Firefox：about:debugging → 此 Firefox → 加载临时附加组件 → 选 dist/manifest.json）
npm run test      # 运行测试套件（141 项断言）
```

## 架构

### 检测管线

```
输入文本
  │
  ▼
场景启发式（env/yaml/json/log/code/plain，零延迟离线可用）
  │
  ▼
正则规则（按 Profile 启用类别）
  ├─ secret 类别: ENV/YAML/JSON/连接串/API Key/JWT/私钥
  ├─ pii 类别:    手机号/身份证(校验位)/银行卡(Luhn)/IP/车牌/邮箱
  └─ entropy:     高熵字符串（阈值随 Profile 灵敏度档位变化）
  │
  ▼（级联触发，仅处理正则未覆盖片段）
GLiNER 模型（gliner + @xenova/transformers + onnxruntime-web，可选）
  ├─ 高置信(>0.65) → 验证后采纳
  ├─ uncertain(0.35-0.65) → 回流正则复检
  └─ 复检不中 → 低置信保留（默认仅提示）
  │
  ▼
去重 → 重叠归并仲裁 → 值传播 → 占位符按值共享
  │
  ▼
语义化中文占位符: <<手机号>> / <<密码:2>> / <<API密钥>>
```

### Profile（场景 Tab）

| Profile | 定位 | 特点 |
|---------|------|------|
| 不限（默认） | 全场景 | 规则并集 + 仲裁，中低置信度仅提示 |
| 通用文本 | 聊天/文档/工单 | PII 为主，高熵 strict（30 字符） |
| 代码开发 | 配置/代码/日志 | 密钥全开，高熵 loose（20 字符），PII 仅提示 |

新增场景 = 在 `src/core/detector/profiles.ts` 加一条配置，无新代码路径。Profile 选择持久化于 `chrome.storage.local`。

### 自定义档案（Phase 4/5）

Tab 栏「＋」基于当前档案克隆出用户自定义档案（⚙ 按钮编辑），可配置：

- **检测类别开关**：密钥凭据 / 个人信息 / 高熵字符串
- **高熵灵敏度**：宽松（20 字符）/ 标准（25）/ 严格（30）
- **分类型默认策略**：10 种类型逐项选择替换/保留
- **值白名单**：每行一个精确值，命中不检测不替换（含值传播的所有出现）
- **AI 模型检测目标**：GLiNER 标签集（个人信息集/密钥集/全部/自定义）
- **自定义正则规则**（Phase 5）：零样本之外补位，带 ReDoS 双层防护——静态拒绝嵌套量词（星号高度检查）+ 运行时 50ms/条执行预算与匹配上限；结果走完整管线（去重/重叠归并/值传播/白名单）
- **JSON 导入导出**（Phase 5）：全部自定义档案经剪贴板导入导出；导入时重新生成 id、重名加序号、危险正则被 sanitize 过滤

自定义档案持久化于 `chrome.storage.local`（`pasteguard.userProfiles`），内置档案不可改删；数据经 sanitize 校验，存储损坏自动丢弃。详见 `docs/phase4-verification.md`、`docs/phase5-verification.md`。

### 粘贴自动拦截（可选，逐站授权）

侧栏「粘贴自动拦截」卡片中添加站点（如 `chat.example.com`），浏览器会弹出该站点的访问授权。授权后：

- 在该站点的输入框 / 文本域粘贴时，**先正常插入原文**（不阻塞输入），检测完成后**就地替换**为占位符
- 检测在 service worker 中跑现有正则管线（GLiNER 模型不会在 SW 加载），无需下载模型
- 站点列表持久化在 `chrome.storage.local`（`pasteguard.protectedSites`），SW 按 `tabs.onUpdated` 按需注入粘贴监听——**未授权站点零接触**（manifest 不声明 `content_scripts`，也不申请 `<all_urls>`）
- 安全护栏：password/隐藏输入框绝不处理；插入文本与剪贴板逐字吻合才改写（站点改写粘贴内容则放弃）；检测期间用户继续输入则放弃改写，绝不覆盖新内容；未检出则完全不动

v1 范围限制：只支持 `input[type=text/search]` 与 `textarea`；`contenteditable` 富文本区域暂不处理（粘贴片段难以可靠定位，待后续版本）。

### Firefox 兼容

同一份 `dist/` 可直接在 Firefox 121+ 加载：

- 侧栏：Chrome 走 `side_panel` + `sidePanel.open()`，Firefox 走 `sidebar_action` + `sidebarAction.open()`，SW 内运行时探测并回退，两者打开同一面板页面
- 后台脚本：manifest 同时声明 `background.service_worker`（Chrome 用）与 `background.scripts`（Firefox 事件页用）。CRXJS 构建会丢弃 `scripts` 键，故 `scripts/postbuild.mjs` 在构建后把它注回（Chrome 121+ 会忽略多余的 `scripts`）
- 已知差异：`sidePanel` 权限与 `side_panel` 键在 Firefox 中会被记为未知项（仅警告，不影响加载）；AMO 提交前需按需拆分 manifest

### 防泄漏保证

- **同值必同占位符**：同一敏感值出现 N 处 → N 处全部替换为同一占位符（值传播覆盖无上下文的裸露出现）
- **区间不重叠**：重叠检测项经仲裁归并（类型优先级：凭据 > PII > 高熵），替换输出永不互切
- **校验防误报**：身份证过 ISO 7064 校验位，银行卡过 Luhn，弱口令字典（含数字后缀变体）过滤

## 项目结构

```
src/
├── core/
│   ├── detector/
│   │   ├── pipeline.ts        # 主管线（级联调度 + 仲裁 + 值传播）
│   │   ├── profiles.ts        # Profile 注册表（场景配置）
│   │   ├── sceneDetector.ts   # 场景启发式（纯规则，无模型）
│   │   ├── contentDetector.ts # GLiNER 级联检测（可选增强）
│   │   └── rules/             # 规则模块（按类别分组）
│   │       ├── envPasswordRules / kvRules / dbPasswordRules
│   │       ├── apiKeyRules / privateKeyRules / emailRules
│   │       ├── piiRules       # 手机号/身份证/银行卡/IP/车牌
│   │       ├── highEntropyRules / valueFilters / constants
│   │       └── scanner        # 扫描器（类别开关 + 类型合并）
│   ├── replacer/              # 替换引擎（纯函数 apply）
│   │   ├── placeholder.ts     # 语义化中文占位符（生成/反解析）
│   │   └── mapping.ts         # 映射表（同值共享）
│   ├── sites.ts               # 受保护站点规范化/匹配（粘贴拦截）
│   ├── messages.ts            # content ↔ SW 消息契约
│   ├── types/                 # 类型定义（DetectionType/ProfileConfig）
│   └── utils/id.ts            # 统一 ID 生成
├── components/                # Vue 组件（ProfileTabs/DetectionItem/PasteInterceptionSettings...）
├── content/pasteText.ts       # 粘贴就地替换纯逻辑（区间推导与改写守卫）
├── stores/detection.ts        # Pinia（Profile 持久化 + 默认策略分层）
├── sidepanel/                 # Side Panel 主界面
└── background/                # Service Worker（侧栏入口跨浏览器 + 粘贴检测服务 + 站点注入）
```

## 测试

```bash
npm test              # 全量（golden + 回归 + 单元 + 性能）
npm run test:watch    # 监听模式
```

| 目录 | 内容 |
|------|------|
| `tests/golden/` | 按 Profile 分组的端到端用例（universal/text/code/whitelist） |
| `tests/regression/` | Phase 1 修复点回归（含@密码/重复值/重叠/CJK 偏移/吞值） |
| `tests/unit/` | 场景启发式/占位符/校验算法/替换引擎/用户档案 CRUD/模型下载器/检测 store 状态机/站点匹配/粘贴就地替换 |
| `tests/perf/` | 长文本基准（5000 字 < 2s） |

手动验证用例见 `docs/phase1-verification.md`、`docs/phase2-verification.md`、`docs/phase4-verification.md`。

## 技术栈

- Vue 3 + Pinia + Tailwind CSS 4 + Reka UI
- @crxjs/vite-plugin（Manifest V3 构建）
- gliner + @xenova/transformers + onnxruntime-web（GLiNER 模型，WASM，可选增强）
- 模型远程加载（主源 ModelScope 镜像，回退 huggingface.co；Range 断点续传 + 指数退避重试 + 停滞看门狗 + Cache Storage 落盘，重开侧栏零下载；失败时静默降级为纯正则，UI 显示降级状态）
