<script setup lang="ts">
import { computed } from 'vue'
import { useVModel } from '@vueuse/core'

interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  rows?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  rows: 4
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const modelValue = useVModel(props, 'modelValue', emit)

const textareaClasses = computed(() => [
  'w-full px-4 py-3 text-sm font-mono rounded-lg transition-all duration-200 resize-none',
  'bg-background border',
  'text-foreground',
  'placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
  'border-input',
  props.disabled && 'opacity-50 cursor-not-allowed'
])
</script>

<template>
  <textarea
    v-model="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :rows="rows"
    :class="textareaClasses"
  />
</template>
