# Phase 1 验证用例

对应改动：重复值泄漏修复、重叠区间归并、含 `@` 密码专项、EMAIL 规则、ID 统一、映射表时序修复。

验证方式：构建插件（`npm run build`）加载后，将下方输入粘贴到 sidepanel，核对「检出结果」和「脱敏预览」两列。

---

## 1. 含 `@` 密码完整识别不截断（核心修复）

### Case 1.1 连接串密码含 @ 和特殊字符

```
mysql://root:R00tP@ss!2024@db.example.com:3306/prod
```

**期望**：检出 1 项 `DB_PASSWORD`，值为 `R00tP@ss!2024`（`@` 前后都完整）；脱敏预览为
`mysql://root:<<DB_PASSWORD:1>>@db.example.com:3306/prod`

### Case 1.2 无用户名格式（redis 常见）

```
redis://:p@ssw0rd@localhost:6379
```

**期望**：检出 `DB_PASSWORD = p@ssw0rd`，主机名 `localhost:6379` 保留。

### Case 1.3 密码含多个 @

```
mongodb://admin:pass@word@mongo1:27017/mydb
```

**期望**：检出 `DB_PASSWORD = pass@word`（以最后一个 `@` 为分隔符）。

### Case 1.4 无密码格式不误捕用户名（回归）

```
mysql://user@host
```

**期望**：不报 `user` 为密码（旧版本会误报）。

### Case 1.5 独立连接串（无 scheme）

```
use admin:hunter2@db01.internal to connect
```

**期望**：检出 `DB_PASSWORD = hunter2`（旧版本此规则是死代码，从不产出）。

### Case 1.6 邮件片段不被误报为密码

```
Contact:support@company.com for details
```

**期望**：`support` 不被报为 DB_PASSWORD；`support@company.com` 识别为 EMAIL。

---

## 2. 重复值全量替换（防泄漏核心修复）

### Case 2.1 同值出现在不同字段

```
DB_PASSWORD=Tr0ub4dor&3x!
OTHER_TOKEN=Tr0ub4dor&3x!
log: password is Tr0ub4dor&3x! ok
```

**期望**：
- 检出列表中 3 处都出现，且**占位符相同**（如都显示 `SECRET #1`）
- 脱敏预览中 3 处全部被替换，**无任何明文残留**
- 旧版本行为：只替换第 1 处，后两处明文泄漏

### Case 2.2 高重复度 API Key

```
curl -H "Authorization: Bearer sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456" https://api.example.com
第一次使用 key: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456
备份记录 sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456 勿外传
```

**期望**：3 处全部替换为同一个 `<<API_KEY:1>>`（或 `<<ENV_PASSWORD:1>>`，取决于归类），预览无残留。

---

## 3. 重叠区间不互切

### Case 3.1 长连接串混排

```
conn = user:Sup3rS3cretP@ssw0rdLongEnough123@db-cluster.prod.internal:5432/app
```

**期望**：检出的检测项之间无区间重叠；脱敏预览结构完好，无 `<<...` 占位符互相嵌套或截断。

---

## 4. EMAIL 识别且默认保留

### Case 4.1 多邮箱

```
请联系 support.team+ci@example.com.cn 或 admin@internal.io 处理
```

**期望**：
- 2 个邮箱都识别为 EMAIL 类型
- **默认动作是「保留」**（不替换），用户可手动切换为替换
- 脱敏预览中邮箱保持原文

### Case 4.2 邮箱与密钥混排

```
deploy key: sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz123456 owner: zhangsan@example.com
```

**期望**：key 替换、邮箱保留，互不干扰。

---

## 5. 跨行吞值修复（新发现的原始缺陷）

### Case 5.1 空值行吞下一行

```
EMPTY_PASSWORD=
SHORT_PASS=ab
COMMON_PASSWORD=realSecret99
```

**期望**：
- `SHORT_PASS=ab` 不被检出（旧版本会把 `EMPTY_PASSWORD=` 和下一行合并成一个误检项）
- `realSecret99` 正常检出

### Case 5.2 弱口令家族过滤

```
COMMON_PASSWORD=password123
WEAK_PASS=admin888
DEFAULT_SECRET=secret
```

**期望**：3 行都不检出（弱词+数字后缀现在也识别为弱口令）。

---

## 6. 类型合并（回归）

### Case 6.1 JWT 归类

```
JWT_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U
```

**期望**：检出项的类型列表同时包含 `ENV_PASSWORD` 和 `JWT`（旧版本 JWT 类型在合并时丢失）。

---

## 7. 高熵规则让位

### Case 7.1 赋值行不整体替换

```
GPG_KEY=A3F1B9C8D7E6F5A4B3C2D1E0F9A8B7C6D5E4F3A2B1C0D9E8@example.com
```

**期望**：只替换 `=` 右边的值，`GPG_KEY=` 前缀保留在预览中（旧版本整行被吞）。

### Case 7.2 含 @ 的特殊字符密码仍可检出

```
SPECIAL_CHARS="p@ss!w0rd#$%^&*()QwErTy123"
```

**期望**：检出为高熵/敏感项（让位逻辑不误伤真正的密码）。

---

## 已知限制（Phase 2 处理）

- 同值多处在 UI 中仍显示为多行（占位符相同），按组合并展示与联动切换在 Phase 2 做
- 高熵阈值在纯文本场景下仍偏松，Phase 2 随 Profile 层一起收紧
- 检出项列表中 EMAIL 默认保留，但「保留」与「替换」同值混选时以组为单位的联动逻辑未实现
