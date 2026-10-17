<script setup lang="ts">
// 档案下拉选择器（替代原顶部 Tab 条）：挂在「输入文本」标题旁，
// 菜单含全部档案 +「＋ 新建自定义档案」；选中自定义档案时旁挂编辑入口
import { ref } from 'vue'
import {
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectViewport,
    SelectItem,
    SelectItemText,
    SelectSeparator
} from 'reka-ui'
import { useDetectionStore } from '../stores/detection'
import { Button, Dialog } from '../ui'
import ProfileSettings from './ProfileSettings.vue'

// 「新建」菜单项的哨兵值（不存在的档案 id，选中即触发创建流程）
const CREATE_VALUE = '__create_profile__'

const store = useDetectionStore()
const showSettings = ref(false)

const onCreate = async () => {
    // 基于当前激活档案新建并自动激活；受控模式下哨兵值不会残留在 trigger 上
    await store.createUserProfile()
    showSettings.value = true
}

const onUpdate = (value: string) => {
    if (value === CREATE_VALUE) {
        void onCreate()
        return
    }
    void store.setActiveProfile(value)
}

const onDelete = async () => {
    if (confirm('确定删除该自定义档案？')) {
        showSettings.value = false
        await store.deleteUserProfile(store.activeProfileId)
    }
}
</script>

<template>
    <div class="flex items-center gap-1 min-w-0">
        <SelectRoot :model-value="store.activeProfileId" @update:model-value="onUpdate">
            <SelectTrigger
                :title="store.activeProfile.description"
                class="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-border
                    bg-muted/50 text-xs font-medium text-foreground
                    hover:bg-muted transition-colors outline-none
                    focus-visible:ring-1 focus-visible:ring-ring
                    data-[placeholder]:text-muted-foreground">
                <SelectValue placeholder="选择档案" />
                <svg class="w-3 h-3 shrink-0 text-muted-foreground" fill="none"
                    stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M19 9l-7 7-7-7" />
                </svg>
            </SelectTrigger>
            <SelectContent position="popper" :side-offset="4"
                class="z-50 min-w-[var(--reka-select-trigger-width)]
                    bg-card border border-border rounded-md shadow-lg p-1">
                <SelectViewport>
                    <SelectItem
                        v-for="profile in store.profiles"
                        :key="profile.id"
                        :value="profile.id"
                        :title="profile.description"
                        class="relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs
                            cursor-pointer select-none outline-none transition-colors
                            data-[highlighted]:bg-muted data-[state=checked]:text-primary
                            data-[state=checked]:font-medium">
                        <SelectItemText>{{ profile.name }}</SelectItemText>
                    </SelectItem>
                    <SelectSeparator class="my-1 h-px bg-border" />
                    <SelectItem
                        :value="CREATE_VALUE"
                        class="relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs
                            cursor-pointer select-none outline-none transition-colors
                            text-muted-foreground
                            data-[highlighted]:bg-muted data-[highlighted]:text-primary">
                        <SelectItemText>＋ 新建自定义档案</SelectItemText>
                    </SelectItem>
                </SelectViewport>
            </SelectContent>
        </SelectRoot>
        <!-- 编辑：仅自定义档案显示 -->
        <Button v-if="store.isActiveProfileCustom" @click="showSettings = true"
            variant="secondary" btn-type="text" size="sm"
            title="编辑当前自定义档案" class="shrink-0 px-1.5">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
        </Button>
        <!-- 自定义档案设置弹窗 -->
        <Dialog
            v-model:open="showSettings"
            title="自定义档案设置"
            :description="store.activeProfile.description"
            width="max-w-lg"
            @close="showSettings = false"
        >
            <ProfileSettings
                v-if="store.isActiveProfileCustom"
                @close="showSettings = false"
                @delete="onDelete"
            />
        </Dialog>
    </div>
</template>
