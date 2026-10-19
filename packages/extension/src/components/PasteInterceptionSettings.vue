<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Button, Input } from '../ui'
import { PROTECTED_SITES_KEY, normalizeSiteInput } from '@engine/sites'

// 粘贴自动拦截设置：逐站授权（optional_host_permissions），
// 只有授权站点才由 service worker 注入粘贴监听
const sites = ref<string[]>([])
const siteInput = ref('')
const busy = ref(false)
const notice = ref('')
const noticeKind = ref<'info' | 'error'>('info')

const setNotice = (text: string, kind: 'info' | 'error' = 'info') => {
    notice.value = text
    noticeKind.value = kind
}

const loadSites = async () => {
    const result = await chrome.storage.local.get(PROTECTED_SITES_KEY)
    const stored = result[PROTECTED_SITES_KEY]
    sites.value = Array.isArray(stored) ? stored.filter((site): site is string => typeof site === 'string') : []
}

const persist = async (next: string[]) => {
    sites.value = next
    await chrome.storage.local.set({ [PROTECTED_SITES_KEY]: next })
}

const addSite = async () => {
    const pattern = normalizeSiteInput(siteInput.value)
    if (!pattern) {
        setNotice('无法识别该站点：请输入域名或 https 地址', 'error')
        return
    }
    if (sites.value.includes(pattern)) {
        setNotice('该站点已在列表中')
        return
    }

    busy.value = true
    try {
        // 必须由用户手势触发：浏览器会弹出「读取 https://xxx 上的数据」授权框
        const granted = await chrome.permissions.request({ origins: [pattern] })
        if (!granted) {
            setNotice('未授权，站点未添加', 'error')
            return
        }
        await persist([...sites.value, pattern])
        siteInput.value = ''
        setNotice('已添加：该站点已打开的页面立即生效，粘贴即自动脱敏')
    } catch (error) {
        setNotice(`授权失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
        busy.value = false
    }
}

const removeSite = async (pattern: string) => {
    await persist(sites.value.filter(site => site !== pattern))
    try {
        await chrome.permissions.remove({ origins: [pattern] })
    } catch {
        // 权限可能仍被列表中其他条目共享，忽略
    }
    setNotice('已移除')
}

onMounted(loadSites)
</script>

<template>
    <!-- 与引擎卡片同规格的全宽贴边区块（p-4 = 内容到面板边框 16px），
         块内分隔统一走 padding，不用 margin -->
    <div class="p-4 bg-muted/50">
        <div>
            <p class="text-sm font-medium text-foreground">粘贴自动拦截</p>
            <!-- 描述：最多 2 行，超出省略 -->
            <p class="text-xs text-muted-foreground pt-0.5 line-clamp-2">
                在已授权站点粘贴时自动脱敏（正则档检测，无需模型）；未授权站点完全不受影响</p>
        </div>

        <!-- 输入与按钮等高 32px（Input h-8 = Button sm 档 h-8）；按钮 shrink-0 防被压窄
             导致文字换行，输入 min-w-0 允许收缩 -->
        <div class="pt-4 flex items-center gap-2">
            <Input v-model="siteInput" placeholder="例如 chat.example.com" :disabled="busy"
                class="h-8 min-w-0 input-fixed" @keyup.enter="addSite" />
            <Button size="sm" :disabled="busy" @click="addSite" class="shrink-0">添加</Button>
        </div>

        <p v-if="notice" class="pt-4 text-xs"
            :class="noticeKind === 'error' ? 'text-warning' : 'text-muted-foreground'">
            {{ notice }}
        </p>

        <ul v-if="sites.length" class="pt-4 space-y-1">
            <li v-for="site in sites" :key="site" class="flex items-center justify-between gap-2">
                <span class="text-xs font-mono text-foreground truncate">{{ site }}</span>
                <button class="text-xs text-warning hover:underline shrink-0" @click="removeSite(site)">
                    移除
                </button>
            </li>
        </ul>
        <p v-else class="pt-4 text-xs text-muted-foreground">
            未添加站点：粘贴行为保持原样
        </p>
    </div>
</template>

<style scoped>
.input-fixed {
    padding: 10px !important
}
</style>