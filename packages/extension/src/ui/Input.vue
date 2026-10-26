<script setup lang="ts">
import { computed } from 'vue'
import { useVModel } from '@vueuse/core'

interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  error?: boolean
  type?: 'text' | 'password' | 'email' | 'number'
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  error: false,
  type: 'text'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const modelValue = useVModel(props, 'modelValue', emit)

const inputClasses = computed(() => [
  'w-full px-4 py-2.5 text-sm rounded-lg transition-all duration-200',
  'bg-background border',
  'text-foreground',
  'placeholder:text-muted-foreground',
  // 焦点样式与 InputArea 的 textarea 统一（两处需同步改）：1px ring + 聚焦时边框透明
  'focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent',
  props.error
    ? 'border-destructive focus:ring-destructive'
    : 'border-border',
  props.disabled && 'opacity-50 cursor-not-allowed'
])
</script>

<template>
  <input
    v-model="modelValue"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="inputClasses"
  />
</template>
