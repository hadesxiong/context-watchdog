<script setup lang="ts">
// 自定义档案编辑面板（Phase 4/5）：类别开关 / 灵敏度 / 默认策略 / 白名单 / AI 标签 / 自定义正则 / 导入导出
// 编辑本地草稿，点击保存时提交；内置档案不渲染本组件
import { ref, reactive, watch } from 'vue'
import { useDetectionStore } from '../stores/detection'
import { Button, Input, Textarea, Switch } from '../ui'
import { validateCustomRule, CUSTOM_PATTERN_MAX_LENGTH } from '@engine/detector/rules/customRules'
import type { ProfileConfig, RuleCategory, Sensitivity, DetectionType, CustomRule } from '@engine/types'

const emit = defineEmits<{
    (e: 'close'): void
    (e: 'delete'): void
}>()

const store = useDetectionStore()

// ---- 本地草稿（深拷贝激活档案，避免直接改 store） ----
const draft = reactive<ProfileConfig>(structuredClone(store.activeProfile))
// customRules 可选字段 → 组件内用必备数组操作，保存时写回 draft
const customRules = ref<CustomRule[]>([...(draft.customRules || [])])
const whitelistText = ref((store.activeProfile.whitelist || []).join('\n'))
const error = ref('')
const saving = ref(false)

// ---- 自定义正则规则编辑（Phase 5） ----
const newRule = reactive<{ name: string; pattern: string; type: DetectionType; confidence: 'high' | 'medium' | 'low' }>({
    name: '',
    pattern: '',
    type: 'ENV_PASSWORD',
    confidence: 'high'
})
const ruleError = ref('')
const showRuleForm = ref(false)

const RULE_TYPE_OPTIONS: Array<{ key: DetectionType; label: string }> = [
    { key: 'ENV_PASSWORD', label: '密码' },
    { key: 'API_KEY', label: 'API 密钥' },
    { key: 'DB_PASSWORD', label: '连接串密码' },
    { key: 'JWT', label: 'JWT' },
    { key: 'PRIVATE_KEY', label: '私钥' },
    { key: 'HIGH_ENTROPY', label: '高熵串' },
    { key: 'EMAIL', label: '邮箱' },
    { key: 'PHONE', label: '手机号/座机' },
    { key: 'ID_CARD', label: '身份证' },
    { key: 'BANK_CARD', label: '银行卡' },
    { key: 'IP_ADDRESS', label: 'IP 地址' },
    { key: 'PLATE', label: '车牌' },
    { key: 'NAME', label: '姓名' },
    { key: 'ADDRESS', label: '地址' }
]

const addRule = () => {
    ruleError.value = ''
    const validation = validateCustomRule(newRule, customRules.value)
    if (!validation.ok) {
        ruleError.value = validation.error || '规则不合法'
        return
    }

    customRules.value.push({
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: newRule.name.trim(),
        pattern: newRule.pattern.trim(),
        type: newRule.type,
        confidence: newRule.confidence,
        enabled: true
    } as CustomRule)

    newRule.name = ''
    newRule.pattern = ''
    showRuleForm.value = false
}

const removeRule = (id: string) => {
    const idx = customRules.value.findIndex(r => r.id === id)
    if (idx >= 0) customRules.value.splice(idx, 1)
}

// ---- 档案导入导出（Phase 5） ----
const ioMessage = ref('')
const ioError = ref('')

const onExport = async () => {
    ioError.value = ''
    const json = store.exportProfilesJson()
    if (!json) {
        ioMessage.value = ''
        ioError.value = '没有可导出的自定义档案（内置档案无需导出）'
        return
    }
    try {
        await navigator.clipboard.writeText(json)
        ioMessage.value = '全部自定义档案 JSON 已复制到剪贴板'
        ioError.value = ''
    } catch {
        ioError.value = '复制失败，请检查剪贴板权限'
    }
}

const onImport = async () => {
    ioMessage.value = ''
    ioError.value = ''
    let json = ''
    try {
        json = await navigator.clipboard.readText()
    } catch {
        ioError.value = '读取剪贴板失败，请手动粘贴'
        return
    }
    if (!json.trim()) {
        ioError.value = '剪贴板为空，请先复制档案 JSON'
        return
    }
    try {
        const count = await store.importProfilesJson(json)
        ioMessage.value = `成功导入 ${count} 个档案（重名已自动加序号）`
    } catch (e) {
        ioError.value = e instanceof Error ? e.message : '导入失败'
    }
}

// GLiNER 标签预设（与 profiles.ts 内置集一致）
const LABEL_PRESETS: Record<string, string[]> = {
    pii: ['person name', 'phone number', 'home address', 'email address', 'ID card number', 'bank card number'],
    secret: ['password', 'secret', 'api key', 'access token', 'private key', 'connection string']
}
LABEL_PRESETS.all = [...LABEL_PRESETS.pii, ...LABEL_PRESETS.secret]

const currentPreset = ref<'pii' | 'secret' | 'all' | 'custom'>(
    LABEL_PRESETS.all.join('|') === draft.glinerLabels.join('|') ? 'all'
    : LABEL_PRESETS.pii.join('|') === draft.glinerLabels.join('|') ? 'pii'
    : LABEL_PRESETS.secret.join('|') === draft.glinerLabels.join('|') ? 'secret'
    : 'custom'
)
const customLabelsText = ref(draft.glinerLabels.join(', '))

watch(currentPreset, preset => {
    if (preset !== 'custom') {
        draft.glinerLabels = [...LABEL_PRESETS[preset]]
        customLabelsText.value = draft.glinerLabels.join(', ')
    }
})

watch(customLabelsText, () => {
    if (currentPreset.value === 'custom') {
        draft.glinerLabels = customLabelsText.value
            .split(',')
            .map(l => l.trim())
            .filter(l => l !== '')
            .slice(0, 30)
    }
})

// ---- 类别开关 ----
const CATEGORY_LABELS: Array<{ key: RuleCategory; label: string }> = [
    { key: 'secret', label: '密钥凭据' },
    { key: 'pii', label: '个人信息' },
    { key: 'entropy', label: '高熵字符串' }
]

const toggleCategory = (cat: RuleCategory) => {
    const idx = draft.enabledCategories.indexOf(cat)
    if (idx >= 0) draft.enabledCategories.splice(idx, 1)
    else draft.enabledCategories.push(cat)
}

// ---- 灵敏度档位 ----
const SENSITIVITY_LABELS: Array<{ key: Sensitivity; label: string }> = [
    { key: 'loose', label: '宽松' },
    { key: 'standard', label: '标准' },
    { key: 'strict', label: '严格' }
]

// ---- 分类型默认策略（Switch 形式：开 = 替换，关 = 保留） ----
const ACTION_TYPES: Array<{ key: DetectionType; label: string }> = [
    { key: 'ENV_PASSWORD', label: '密码' },
    { key: 'API_KEY', label: 'API 密钥' },
    { key: 'DB_PASSWORD', label: '连接串密码' },
    { key: 'HIGH_ENTROPY', label: '高熵串' },
    { key: 'EMAIL', label: '邮箱' },
    { key: 'PHONE', label: '手机号/座机' },
    { key: 'ID_CARD', label: '身份证' },
    { key: 'BANK_CARD', label: '银行卡' },
    { key: 'IP_ADDRESS', label: 'IP 地址' },
    { key: 'PLATE', label: '车牌' }
]

const currentAction = (key: DetectionType): 'replace' | 'keep' =>
    draft.defaultActions[key] || 'replace'

const setDefaultAction = (key: DetectionType, replace: boolean) => {
    draft.defaultActions = { ...draft.defaultActions, [key]: replace ? 'replace' : 'keep' }
}

// ---- 保存 ----
const onSave = async () => {
    error.value = ''
    draft.whitelist = whitelistText.value
        .split('\n')
        .map(w => w.trim())
        .filter(w => w !== '')
        .slice(0, 200)
    draft.customRules = [...customRules.value]

    saving.value = true
    try {
        await store.updateUserProfile(draft)
        emit('close')
    } catch (e) {
        error.value = e instanceof Error ? e.message : '保存失败'
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <!-- 表单主体：外壳（标题/遮罩/关闭/动画）由外层 Dialog 提供；
         样式对齐外部设计系统：text-sm 正文 / ui Input·Textarea·Button / 统一焦点环与间距；
         与底部操作区（模板第二根节点）同为 100% 弹窗宽度，边距由自身 padding 提供 -->
    <div class="text-sm px-4 py-4 space-y-4">
        <!-- 名称与描述 -->
        <div class="space-y-3">
            <div class="space-y-1.5">
                <label class="block text-sm font-medium text-foreground">档案名称</label>
                <Input v-model="draft.name" maxlength="20" placeholder="如：仅密钥" />
            </div>
            <div class="space-y-1.5">
                <label class="block text-sm font-medium text-foreground">描述</label>
                <Input v-model="draft.description" maxlength="100"
                    placeholder="一句话说明该档案的适用场景" />
            </div>
        </div>

        <!-- 规则类别开关 -->
        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">检测类别</label>
            <div class="flex gap-4">
                <label v-for="cat in CATEGORY_LABELS" :key="cat.key"
                    class="flex items-center gap-1.5 cursor-pointer text-sm text-foreground">
                    <input type="checkbox" :checked="draft.enabledCategories.includes(cat.key)"
                        @change="toggleCategory(cat.key)" class="accent-primary h-3.5 w-3.5" />
                    {{ cat.label }}
                </label>
            </div>
        </div>

        <!-- 灵敏度 -->
        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">高熵灵敏度</label>
            <div class="flex gap-1.5">
                <button v-for="s in SENSITIVITY_LABELS" :key="s.key"
                    @click="draft.sensitivity = { ...draft.sensitivity, entropy: s.key }"
                    :class="[
                        'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                        (draft.sensitivity.entropy || 'standard') === s.key
                            ? 'border-ring text-primary bg-primary/10'
                            : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    ]">
                    {{ s.label }}
                </button>
            </div>
        </div>

        <!-- 置信度分层 -->
        <label class="flex items-center gap-1.5 cursor-pointer text-sm text-foreground">
            <input type="checkbox" v-model="draft.tierLowConfidence" class="accent-primary h-3.5 w-3.5" />
            中低置信度仅提示（不替换）
        </label>

        <!-- 分类型默认策略：Switch（开 = 替换，关 = 保留） -->
        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">默认策略</label>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                <div v-for="t in ACTION_TYPES" :key="t.key"
                    class="flex items-center justify-between gap-2 text-sm text-foreground">
                    <span class="truncate">{{ t.label }}</span>
                    <span class="flex items-center gap-1.5 shrink-0">
                        <span class="w-7 text-right text-xs"
                            :class="currentAction(t.key) === 'replace' ? 'text-primary' : 'text-muted-foreground'">
                            {{ currentAction(t.key) === 'replace' ? '替换' : '保留' }}
                        </span>
                        <Switch size="small"
                            :model-value="currentAction(t.key) === 'replace'"
                            @update:model-value="setDefaultAction(t.key, $event)" />
                    </span>
                </div>
            </div>
        </div>

        <!-- 值白名单 -->
        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">值白名单</label>
            <Textarea v-model="whitelistText" :rows="3" placeholder="example.com&#10;test-account-001" />
            <p class="text-xs text-muted-foreground">每行一个，精确匹配不检测</p>
        </div>

        <!-- 自定义正则规则（Phase 5） -->
        <div class="space-y-1.5">
            <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-foreground">
                    自定义正则（{{ customRules.length }} 条）</label>
                <Button variant="secondary" btnType="text" size="sm" @click="showRuleForm = !showRuleForm">
                    {{ showRuleForm ? '收起' : '＋ 添加' }}</Button>
            </div>

            <!-- 规则列表 -->
            <div v-for="rule in customRules" :key="rule.id"
                class="flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-border">
                <input type="checkbox" v-model="rule.enabled" class="accent-primary h-3.5 w-3.5 shrink-0"
                    :title="rule.enabled ? '已启用' : '已停用'" />
                <div class="flex-1 min-w-0">
                    <p class="text-sm text-foreground truncate">{{ rule.name }}
                        <span class="text-xs text-muted-foreground">→ {{ RULE_TYPE_OPTIONS.find(t => t.key === rule.type)?.label }}</span>
                    </p>
                    <p class="text-xs text-muted-foreground font-mono truncate">{{ rule.pattern }}</p>
                </div>
                <button @click="removeRule(rule.id)"
                    class="text-muted-foreground hover:text-destructive shrink-0 p-1 rounded-md
                        hover:bg-destructive/10 transition-colors" title="删除规则">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>

            <!-- 添加表单 -->
            <div v-if="showRuleForm" class="p-3 space-y-1.5 rounded-md border border-primary/20 bg-primary/5">
                <Input v-model="newRule.name" maxlength="20" placeholder="规则名称（如：工号）" />
                <Input v-model="newRule.pattern" :maxlength="CUSTOM_PATTERN_MAX_LENGTH"
                    placeholder="正则（如：EMP-\d{6}）" />
                <div class="flex gap-1.5">
                    <select v-model="newRule.type"
                        class="flex-1 px-2 py-1.5 rounded-md border border-input bg-background text-sm text-foreground
                            focus:outline-none focus:ring-2 focus:ring-ring">
                        <option v-for="t in RULE_TYPE_OPTIONS" :key="t.key" :value="t.key">{{ t.label }}</option>
                    </select>
                    <select v-model="newRule.confidence"
                        class="px-2 py-1.5 rounded-md border border-input bg-background text-sm text-foreground
                            focus:outline-none focus:ring-2 focus:ring-ring">
                        <option value="high">高置信</option>
                        <option value="medium">中置信</option>
                        <option value="low">低置信</option>
                    </select>
                </div>
                <p v-if="ruleError" class="text-destructive text-xs">{{ ruleError }}</p>
                <Button class="w-full" size="sm" @click="addRule">添加规则</Button>
            </div>
            <p class="text-xs text-muted-foreground">
                拒绝嵌套量词（如 <code>(a+)+</code>）防 ReDoS；每条规则有 50ms 执行预算
            </p>
        </div>

        <!-- AI 检测标签 -->
        <div class="space-y-1.5">
            <label class="block text-sm font-medium text-foreground">AI 模型检测目标（GLiNER 标签）</label>
            <div class="flex gap-1.5 flex-wrap">
                <button v-for="(preset, key) in { pii: '个人信息集', secret: '密钥集', all: '全部', custom: '自定义' }"
                    :key="key" @click="currentPreset = key as typeof currentPreset"
                    :class="[
                        'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                        currentPreset === key
                            ? 'border-ring text-primary bg-primary/10'
                            : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    ]">
                    {{ preset }}
                </button>
            </div>
            <Textarea v-if="currentPreset === 'custom'" v-model="customLabelsText" :rows="2"
                placeholder="person name, phone number" />
        </div>
    </div>

    <!-- 操作：sticky 固定于弹窗可视区底部（与顶部标题同逻辑，不随内容滚动）；
         模板第二根节点，占满弹窗宽度、自身 px-4 提供边距（pb-4 与标题区 pt-4 对称）；
         bg-card 覆盖滚过的内容，border-t 与标题区 border-b 呼应；
         关闭由标题栏 × / Esc 承担，不设取消 -->
    <div class="sticky bottom-0 bg-card border-t border-border px-4 pt-3 pb-4 space-y-1.5">
        <div class="flex items-center gap-2">
            <!-- md 档（px-3 py-1.5 text-sm）：字号/内边距与表单内预设按钮（个人信息集等）一致 -->
            <Button variant="secondary" btnType="outline"
                title="复制全部自定义档案 JSON 到剪贴板" @click="onExport">导出</Button>
            <Button variant="secondary" btnType="outline"
                title="从剪贴板读取档案 JSON 并导入" @click="onImport">导入</Button>
            <div class="ml-auto flex items-center gap-2">
                <!-- 删除：primary 形状（实心），危险红配色 -->
                <Button variant="danger" @click="emit('delete')">
                    删除档案</Button>
                <Button :loading="saving" @click="onSave">
                    {{ saving ? '保存中…' : '保存' }}</Button>
            </div>
        </div>
        <p v-if="error" class="text-destructive text-xs">{{ error }}</p>
        <p v-if="ioMessage" class="text-success text-xs">{{ ioMessage }}</p>
        <p v-if="ioError" class="text-destructive text-xs">{{ ioError }}</p>
    </div>
</template>
