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
  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0',
  props.error
    ? 'border-destructive focus:ring-destructive focus:border-destructive'
    : 'border-input focus:ring-ring focus:border-ring',
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
