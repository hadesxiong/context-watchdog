<script setup lang="ts">
import { computed } from 'vue'
import { SwitchRoot, SwitchThumb } from 'reka-ui'

interface Props {
  modelValue?: boolean
  disabled?: boolean
  loading?: boolean
  size?: 'medium' | 'small'
  type?: 'round' | 'square'
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  disabled: false,
  loading: false,
  size: 'medium',
  type: 'round'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const checked = computed({
  get: () => props.modelValue ?? false,
  set: (val: boolean) => emit('update:modelValue', val)
})

const sizeClasses = computed(() => {
  const shape = props.type === 'square' ? 'rounded-sm' : 'rounded-full'
  const size = props.size === 'small' ? 'h-5 w-8' : 'h-6 w-10'
  return `${size} ${shape}`
})

const thumbClasses = computed(() => {
  const shape = props.type === 'square' ? 'rounded-sm' : 'rounded-full'
  const size = props.size === 'small' ? 'h-3 w-3' : 'h-4 w-4'
  return `${size} ${shape}`
})

const thumbTranslate = computed(() => {
  return checked.value
    ? (props.size === 'small' ? 'translate-x-[16px]' : 'translate-x-[20px]')
    : 'translate-x-1'
})
</script>

<template>
  <SwitchRoot
    v-model="checked"
    :disabled="disabled || loading"
    :class="[
      'peer inline-flex shrink-0 cursor-pointer items-center transition-colors duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      sizeClasses,
      checked
        ? 'bg-primary'
        : 'bg-input'
    ]"
  >
    <SwitchThumb
      :class="[
        'pointer-events-none block bg-white shadow-lg ring-0 transition-all duration-200',
        thumbClasses,
        thumbTranslate,
        loading && 'scale-75'
      ]"
    >
      <svg
        v-if="loading"
        class="animate-spin h-full w-full text-primary"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </SwitchThumb>
  </SwitchRoot>
</template>
