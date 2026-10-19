<script setup lang="ts">
// 档案下拉选择器（替代原顶部 Tab 条）：挂在「输入文本」标题旁。
// 菜单项两行布局：档案名 + 说明小字；自定义档案项右侧内嵌编辑齿轮
// （点齿轮 = 先激活该档案再打开编辑弹窗，保证编辑的就是当前生效档案）
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
import { Dialog } from '../ui'
import ProfileSettings from './ProfileSettings.vue'

// 「新建」菜单项的哨兵值（不存在的档案 id，选中即触发创建流程）
const CREATE_VALUE = '__create_profile__'

const store = useDetectionStore()
const showSettings = ref(false)
// 菜单开合受控：编辑齿轮需在不触发 Item 选中的前提下显式关闭菜单
// （SelectItem 的选中/关菜单挂在 pointerup 上，拦掉后菜单不会自行关闭）
const menuOpen = ref(false)

// 自定义档案判定：非内置即用户自定义（见 ProfileConfig.builtin）
const isCustom = (profile: { builtin?: boolean }) => profile.builtin === false

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

// 菜单项内点编辑齿轮：同步「关菜单 → 切档案 → 开编辑弹窗」（一次 flush 内完成）。
// 档案切换不 await（store 内 activeProfileId 是同步更新的，弹窗读取即为新档案；
// 若有待检文本，重检在后台跑，不阻塞弹窗打开）
const onEdit = (profileId: string, event: MouseEvent) => {
    // 阻断 SelectItem 的选中/关闭流程，只执行编辑
    event.preventDefault()
    event.stopPropagation()
    menuOpen.value = false
    void store.setActiveProfile(profileId)
    showSettings.value = true
}

const onDelete = async () => {
    if (confirm('确定删除该自定义档案？')) {
        showSettings.value = false
        await store.deleteUserProfile(store.activeProfileId)
    }
}
</script>

<template>
    <SelectRoot :model-value="store.activeProfileId" :open="menuOpen"
        @update:open="menuOpen = $event"
        @update:model-value="onUpdate">
        <SelectTrigger
            :title="'模式:' + store.activeProfile.description"
            class="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-input
                bg-background text-sm font-medium text-foreground max-w-45
                hover:bg-muted/60 transition-colors outline-none
                focus-visible:ring-2 focus-visible:ring-ring
                data-placeholder:text-muted-foreground">
            <!-- <SelectValue placeholder="选择档案" class="truncate" /> -->
            <span class="flex items-center min-w-0 gap-1">
                <span class="shrink-0">模式:</span>
                <SelectValue placeholder="选择档案" class="truncate" />
            </span>
            <svg class="w-3.5 h-3.5 shrink-0 text-muted-foreground" fill="none"
                stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 9l-7 7-7-7" />
            </svg>
        </SelectTrigger>
        <SelectContent position="popper" :side-offset="4"
            class="z-50 min-w-65 max-w-80
                bg-popover border border-input rounded-md shadow-lg p-1">
            <SelectViewport>
                <SelectItem
                    v-for="profile in store.profiles"
                    :key="profile.id"
                    :value="profile.id"
                    class="relative flex items-center justify-between gap-2 rounded-sm px-2.5 py-2
                        text-sm cursor-pointer select-none outline-none transition-colors text-muted-foreground
                        data-highlighted:bg-muted data-[state=checked]:text-primary">
                    <div class="min-w-0 flex-1">
                        <SelectItemText>
                            <span :class="profile.id === store.activeProfileId && 'font-medium'">
                                {{ profile.name }}</span>
                        </SelectItemText>
                        <!-- 档案说明：选项内第二行小字，超一行省略号截断（预设/自定义一致） -->
                        <p class="text-xs text-muted-foreground leading-snug truncate mt-0.5">
                            {{ profile.description }}</p>
                    </div>
                    <!-- 编辑齿轮：仅自定义档案；pointerup/touchend 必须拦（SelectItem 在
                         pointerup 上选中并关菜单，菜单在 click 派发前就卸载 → 点击丢失；
                         item 的 touchend prevent 还会吞掉触屏合成 click） -->
                    <button v-if="isCustom(profile)"
                        @pointerdown.stop @pointerup.stop @touchend.stop
                        @click="onEdit(profile.id, $event)"
                        class="shrink-0 p-2 rounded-sm text-muted-foreground
                            hover:text-foreground hover:bg-accent transition-colors"
                        :title="`编辑「${profile.name}」`">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
                </SelectItem>
                <SelectSeparator class="my-1 h-px bg-border" />
                <SelectItem
                    :value="CREATE_VALUE"
                    class="relative flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm
                        cursor-pointer select-none outline-none transition-colors
                        text-muted-foreground
                        data-highlighted:bg-muted data-highlighted:text-primary">
                    <SelectItemText>＋ 新建自定义档案</SelectItemText>
                </SelectItem>
            </SelectViewport>
        </SelectContent>
    </SelectRoot>
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
</template>
